#!/usr/bin/env python3
"""build_site.py — build the produced projects from a set of runs into a static site.

For every (prompt, model) cell under the requested runs, this installs deps and runs
`vite build` with a relative base so the bundle works from any sub-path, copies the
resulting dist/ into the output site, and writes an index.html linking to every playable
artifact (grouped run -> prompt -> model, with the run's results.md alongside).

`tsc` is intentionally bypassed: the per-cell `npm run build` chains `tsc && vite build`,
but a model that ships a type error still produces a runnable bundle — the typecheck is
already scored separately by bench-validate, so here we only want the artifact.

Layout produced (default output dir: site/):
    site/index.html                              landing page
    site/build-report.json                       per-cell build outcome
    site/<run-id>/results.md                      copied if present
    site/<run-id>/<prompt-id>/<model-slug>/       vite dist (index.html + assets)
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from html import escape
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = BENCH_ROOT / "runs"
DEFAULT_OUTPUT = BENCH_ROOT / "site"

# Mirror run_bench.py: when a flake is present AND nix is installed, build inside the
# pinned devShell. In CI (node from setup-node, no nix) fall back to PATH transparently.
ENV_PREFIX = (["nix", "develop", str(BENCH_ROOT), "-c"]
              if (BENCH_ROOT / "flake.nix").is_file() and shutil.which("nix")
              else [])


@dataclass(frozen=True)
class Cell:
    """One produced project: its workspace and where it lands in the site."""
    run_id: str
    rel: Path          # cell path relative to RUNS_DIR, e.g. <run>/<prompt>/<model>
    workspace: Path    # absolute path to the workspace (vite project root)

    @property
    def label(self) -> str:
        return str(self.rel)

    @property
    def meta(self) -> dict:
        meta_file = self.workspace.parent / "meta.json"
        if meta_file.is_file():
            try:
                return json.loads(meta_file.read_text())
            except json.JSONDecodeError:
                return {}
        return {}


@dataclass
class BuildResult:
    cell: Cell
    ok: bool
    duration_seconds: float
    detail: str  # "built" or the failing step / reason


def discover_cells(run_ids: list[str]) -> list[Cell]:
    """Find every workspace/ holding a package.json under each requested run."""
    cells: list[Cell] = []
    for run_id in run_ids:
        run_dir = RUNS_DIR / run_id
        if not run_dir.is_dir():
            raise SystemExit(f"error: run {run_id!r} not found under {RUNS_DIR}")
        found = 0
        for pkg in sorted(run_dir.glob("**/workspace/package.json")):
            if "node_modules" in pkg.parts:
                continue
            workspace = pkg.parent
            cells.append(Cell(run_id, workspace.parent.relative_to(RUNS_DIR), workspace))
            found += 1
        if found == 0:
            print(f"warning: run {run_id!r} has no buildable workspaces", file=sys.stderr)
    return cells


def resolve_runs(requested: list[str]) -> list[str]:
    """Requested run ids, or every run dir (skipping symlinks like `latest`)."""
    if requested:
        return requested
    runs = sorted(d.name for d in RUNS_DIR.iterdir()
                  if d.is_dir() and not d.is_symlink())
    if not runs:
        raise SystemExit(f"error: no runs under {RUNS_DIR}")
    return runs


def run_step(cmd: list[str], cwd: Path, log) -> bool:
    """Run one build step, tee-ing output to the per-cell build log. True on exit 0."""
    log.write(f"$ {' '.join(cmd)}\n")
    log.flush()
    proc = subprocess.run(ENV_PREFIX + cmd, cwd=cwd, stdout=log, stderr=subprocess.STDOUT,
                          stdin=subprocess.DEVNULL)
    log.write(f"-> exit {proc.returncode}\n\n")
    log.flush()
    return proc.returncode == 0


def build_cell(cell: Cell, output: Path) -> BuildResult:
    """Install deps, vite-build (relative base, no tsc), copy dist into the site."""
    dest = output / cell.rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    log_path = dest.parent / f"{cell.workspace.parent.name}.build.log"
    started = time.monotonic()

    def done(ok: bool, detail: str) -> BuildResult:
        return BuildResult(cell, ok, round(time.monotonic() - started, 1), detail)

    print(f"[build] {cell.label}", flush=True)
    with log_path.open("w") as log:
        if (cell.workspace / "package-lock.json").is_file():
            install = ["npm", "ci", "--no-audit", "--no-fund"]
        else:
            install = ["npm", "install", "--no-audit", "--no-fund"]
        if not run_step(install, cell.workspace, log):
            return done(False, "npm install failed")
        # Bypass the package.json `tsc && vite build` chain — call vite directly so a
        # type error doesn't gate the runnable artifact. Relative base => works at any path.
        if not run_step(["npx", "--no-install", "vite", "build", "--base=./"],
                        cell.workspace, log):
            return done(False, "vite build failed")

    dist = cell.workspace / "dist"
    if not (dist / "index.html").is_file():
        return done(False, "no dist/index.html after build")
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(dist, dest)
    log_path.unlink(missing_ok=True)  # keep only failing logs in the site
    return done(True, "built")


def copy_run_metadata(run_ids: list[str], output: Path) -> None:
    """Copy each run's results.md / manifest.json into the site for linking."""
    for run_id in run_ids:
        for name in ("results.md", "manifest.json"):
            src = RUNS_DIR / run_id / name
            if src.is_file():
                dst = output / run_id / name
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)


def _status_badge(status: str) -> str:
    color = {"ok": "#1a7f37", "error": "#cf222e", "timeout": "#9a6700"}.get(status, "#57606a")
    return f'<span class="badge" style="background:{color}">{escape(status)}</span>'


def render_index(results: list[BuildResult], run_ids: list[str], output: Path) -> None:
    """Write site/index.html grouping built artifacts by run -> cell."""
    by_run: dict[str, list[BuildResult]] = {}
    for r in results:
        by_run.setdefault(r.cell.run_id, []).append(r)

    built = sum(1 for r in results if r.ok)
    rows = [
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>llm-bench — produced artifacts</title>",
        "<style>",
        "body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f6f8fa;color:#1f2328}",
        "header{background:#24292f;color:#fff;padding:1.5rem 2rem}",
        "header h1{margin:0;font-size:1.4rem}header p{margin:.4rem 0 0;opacity:.8}",
        "main{max-width:960px;margin:0 auto;padding:2rem}",
        "section{background:#fff;border:1px solid #d0d7de;border-radius:8px;"
        "margin-bottom:1.5rem;overflow:hidden}",
        "section>h2{margin:0;padding:.9rem 1.2rem;background:#f6f8fa;"
        "border-bottom:1px solid #d0d7de;font-size:1.05rem}",
        ".meta{padding:.3rem 1.2rem;font-size:.85rem;color:#57606a}",
        "table{width:100%;border-collapse:collapse}",
        "td,th{padding:.6rem 1.2rem;border-top:1px solid #eaeef2;text-align:left}",
        "th{font-size:.8rem;text-transform:uppercase;color:#57606a;letter-spacing:.03em}",
        ".badge{color:#fff;padding:.1rem .5rem;border-radius:10px;font-size:.75rem}",
        "a.play{font-weight:600;text-decoration:none;color:#0969da}",
        "a.play:hover{text-decoration:underline}",
        ".failed{color:#cf222e}",
        "code{background:#eff1f3;padding:.1rem .3rem;border-radius:4px;font-size:.85em}",
        "</style></head><body>",
        "<header><h1>llm-bench — produced artifacts</h1>",
        f"<p>{built}/{len(results)} projects built · "
        f"{len(run_ids)} run(s)</p></header>",
        "<main>",
    ]

    for run_id in run_ids:
        run_results = sorted(by_run.get(run_id, []), key=lambda r: r.cell.label)
        if not run_results:
            continue
        rows.append("<section>")
        rows.append(f"<h2>{escape(run_id)}</h2>")
        if (output / run_id / "results.md").is_file():
            rows.append(f'<p class="meta">validation: '
                        f'<a href="{escape(run_id)}/results.md">results.md</a></p>')
        rows.append("<table><tr><th>project</th><th>model</th><th>status</th>"
                    "<th>build</th><th>run time</th><th></th></tr>")
        for r in run_results:
            meta = r.cell.meta
            model = meta.get("model") or "—"
            if meta.get("effort"):
                model += f" @{meta['effort']}"
            status = _status_badge(meta["status"]) if meta.get("status") else "—"
            dur = meta.get("duration_seconds")
            run_time = f"{dur}s" if dur is not None else "—"
            # project cell path minus the run id prefix
            cell_path = str(r.cell.rel.relative_to(run_id))
            if r.ok:
                build_cell_html = '<span class="badge" style="background:#1a7f37">ok</span>'
                play = f'<a class="play" href="{escape(str(r.cell.rel))}/index.html">▶ play</a>'
            else:
                build_cell_html = (f'<span class="failed" title="{escape(r.detail)}">'
                                   f'✗ {escape(r.detail)}</span>')
                log_name = f"{r.cell.workspace.parent.name}.build.log"
                play = f'<a href="{escape(str(r.cell.rel.parent))}/{escape(log_name)}">log</a>'
            rows.append(f"<tr><td><code>{escape(cell_path)}</code></td>"
                        f"<td>{escape(model)}</td><td>{status}</td>"
                        f"<td>{build_cell_html}</td><td>{run_time}</td><td>{play}</td></tr>")
        rows.append("</table></section>")

    rows.append("</main></body></html>")
    (output / "index.html").write_text("\n".join(rows) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run_id", nargs="*",
                        help="run id(s) to build (default: every run dir under runs/)")
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_OUTPUT,
                        help=f"output site directory (default: {DEFAULT_OUTPUT})")
    parser.add_argument("-j", "--jobs", type=int, default=os.cpu_count() or 1,
                        help="parallel cell builds (default: nproc)")
    parser.add_argument("--clean", action="store_true",
                        help="remove the output directory before building")
    args = parser.parse_args()

    if shutil.which("npm") is None:
        raise SystemExit("error: npm not on PATH")

    run_ids = resolve_runs(args.run_id)
    cells = discover_cells(run_ids)
    if not cells:
        raise SystemExit("error: no buildable workspaces in the requested run(s)")

    output: Path = args.output.resolve()
    if args.clean and output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)

    if ENV_PREFIX:
        print("warming nix devShell ...", flush=True)
        subprocess.run([*ENV_PREFIX, "true"], check=True)

    print(f"building {len(cells)} project(s) from {len(run_ids)} run(s) "
          f"-> {output} ({args.jobs} parallel)")
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda c: build_cell(c, output), cells))

    copy_run_metadata(run_ids, output)
    render_index(results, run_ids, output)
    (output / "build-report.json").write_text(json.dumps([
        {"cell": str(r.cell.rel), "ok": r.ok,
         "duration_seconds": r.duration_seconds, "detail": r.detail}
        for r in results], indent=2) + "\n")

    built = sum(1 for r in results if r.ok)
    for r in results:
        if not r.ok:
            print(f"  FAILED {r.cell.label}: {r.detail}", file=sys.stderr)
    print(f"done: {built}/{len(results)} built -> {output}/index.html")
    return 0 if built == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
