#!/usr/bin/env python3
"""run_bench.py — run benchmark prompts across pi models in parallel, isolated workdirs.

Each (prompt, model) cell gets a fresh workspace/ directory; pi runs non-interactively
(`pi -p`) inside it under a per-prompt timeout. Cell results land in
runs/<run-id>/<prompt-id>/<model-slug>/ — see README.md for the full layout.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import tomllib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
PROMPTS_DIR = BENCH_ROOT / "prompts"
RUNS_DIR = BENCH_ROOT / "runs"
CONFIG_FILE = BENCH_ROOT / "bench.toml"

EFFORT_LEVELS = {"off", "minimal", "low", "medium", "high", "xhigh"}
KILL_GRACE_SECONDS = 30

# When the bench root carries a flake, every cell runs inside its devShell so pi's
# child processes (bash tool -> node/npm/npx) find the pinned toolchain on PATH.
ENV_PREFIX = (["nix", "develop", str(BENCH_ROOT), "-c"]
              if (BENCH_ROOT / "flake.nix").is_file() else [])


@dataclass(frozen=True)
class Target:
    provider: str
    model: str
    effort: str | None

    @property
    def spec(self) -> str:  # pi --model argument
        return f"{self.provider}/{self.model}"

    @property
    def label(self) -> str:
        return f"{self.spec} ({self.effort})" if self.effort else self.spec

    @property
    def slug(self) -> str:
        raw = self.spec + (f"@{self.effort}" if self.effort else "")
        return "".join(c if c.isalnum() or c in "-" else "_" for c in raw)


@dataclass(frozen=True)
class Cell:
    prompt_dir: Path
    target: Target
    timeout_seconds: int

    @property
    def prompt_id(self) -> str:
        return self.prompt_dir.name


def parse_target(token: str) -> Target:
    """Parse 'provider/model[@effort]' (CLI -m form)."""
    spec, _, effort = token.partition("@")
    provider, sep, model = spec.partition("/")
    if not sep or not provider or not model:
        raise SystemExit(f"error: bad model token {token!r}, expected provider/model[@effort]")
    return Target(provider, model, validate_effort(effort or None, token))


def validate_effort(effort: str | None, context: str) -> str | None:
    if effort is not None and effort not in EFFORT_LEVELS:
        raise SystemExit(
            f"error: bad effort {effort!r} in {context!r}, "
            f"expected one of {', '.join(sorted(EFFORT_LEVELS))}"
        )
    return effort


def load_config() -> tuple[list[Target], int, int]:
    if not CONFIG_FILE.is_file():
        raise SystemExit(f"error: {CONFIG_FILE} missing")
    with CONFIG_FILE.open("rb") as f:
        config = tomllib.load(f)
    targets = []
    for entry in config.get("models", []):
        try:
            provider, model = entry["provider"], entry["model"]
        except KeyError as e:
            raise SystemExit(f"error: [[models]] entry {entry!r} lacks {e}")
        targets.append(Target(provider, model, validate_effort(entry.get("effort"), str(entry))))
    defaults = config.get("defaults", {})
    return targets, int(defaults.get("jobs", 0)), int(defaults.get("timeout_seconds", 3600))


def resolve_prompts(requested: list[str]) -> list[Path]:
    if requested:
        dirs = []
        for p in requested:
            for candidate in (Path(p), PROMPTS_DIR / p):
                if (candidate / "PROMPT.md").is_file():
                    dirs.append(candidate.resolve())
                    break
            else:
                raise SystemExit(f"error: prompt {p!r} not found (no PROMPT.md)")
        return dirs
    dirs = sorted(d for d in PROMPTS_DIR.iterdir() if (d / "PROMPT.md").is_file())
    if not dirs:
        raise SystemExit(f"error: no prompts under {PROMPTS_DIR}")
    return dirs


def prompt_timeout(prompt_dir: Path, override: int | None, default: int) -> int:
    if override is not None:
        return override
    meta = prompt_dir / "meta.json"
    if meta.is_file():
        value = json.loads(meta.read_text()).get("timeout_seconds")
        if value is not None:
            return int(value)
    return default


def run_cell(cell: Cell, run_root: Path) -> bool:
    """Run one (prompt, model) cell; returns True on pi exit 0. Never raises."""
    cell_dir = run_root / cell.prompt_id / cell.target.slug
    workspace = cell_dir / "workspace"
    workspace.mkdir(parents=True)
    (cell_dir / "session").mkdir()

    cmd = ENV_PREFIX + ["pi", "-p", "--mode", "text",
           "--model", cell.target.spec,
           "--session-dir", str(cell_dir / "session")]
    # Replace the user-global mcp.json with an empty server set: benchmark cells must
    # not see cq MCP tools (codegraph/ledger) — ledger-mcp scaffolds docs/ into the
    # workspace, and keep-alive MCP children are suspected of blocking pi's exit.
    mcp_config = BENCH_ROOT / "mcp.bench.json"
    if mcp_config.is_file():
        cmd += ["--mcp-config", str(mcp_config)]
    if cell.target.effort:
        cmd += ["--thinking", cell.target.effort]
    cmd.append((cell.prompt_dir / "PROMPT.md").read_text())

    print(f"[start] {cell.prompt_id} / {cell.target.label} (timeout {cell.timeout_seconds}s)",
          flush=True)
    started = time.monotonic()
    status = "ok"
    with (cell_dir / "pi.log").open("wb") as out, (cell_dir / "pi.err").open("wb") as err:
        # pi spawns child processes (bash tool); own process group so timeout kills all.
        proc = subprocess.Popen(cmd, cwd=workspace, stdout=out, stderr=err,
                                stdin=subprocess.DEVNULL, start_new_session=True)
        try:
            code = proc.wait(timeout=cell.timeout_seconds)
            if code != 0:
                status = "error"
        except subprocess.TimeoutExpired:
            status = "timeout"
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                code = proc.wait(timeout=KILL_GRACE_SECONDS)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                code = proc.wait()

    duration = round(time.monotonic() - started)
    (cell_dir / "meta.json").write_text(json.dumps({
        "prompt": cell.prompt_id,
        "provider": cell.target.provider,
        "model": cell.target.model,
        "effort": cell.target.effort,
        "exit_code": code,
        "status": status,
        "duration_seconds": duration,
    }, indent=2) + "\n")
    print(f"[done ] {cell.prompt_id} / {cell.target.label}: {status} ({code}, {duration}s)",
          flush=True)
    return status == "ok"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-p", "--prompt", action="append", default=[],
                        help="prompt id or path (repeatable; default: all under prompts/)")
    parser.add_argument("-m", "--model", action="append", default=[], metavar="P/M[@EFFORT]",
                        help="model override 'provider/model[@effort]' "
                             "(repeatable; default: [[models]] from bench.toml)")
    parser.add_argument("-j", "--jobs", type=int, help="parallel cells (default: bench.toml/nproc)")
    parser.add_argument("-t", "--timeout", type=int,
                        help="per-cell timeout seconds (overrides prompt meta.json)")
    parser.add_argument("-r", "--run-id", help="run id (default: UTC timestamp)")
    args = parser.parse_args()

    if shutil.which("pi") is None:
        raise SystemExit("error: pi not on PATH")

    config_targets, config_jobs, default_timeout = load_config()
    targets = [parse_target(t) for t in args.model] or config_targets
    if not targets:
        raise SystemExit("error: model set is empty (no -m and no [[models]] in bench.toml)")
    prompts = resolve_prompts(args.prompt)
    jobs = args.jobs or config_jobs or os.cpu_count() or 1

    cells = [Cell(p, t, prompt_timeout(p, args.timeout, default_timeout))
             for p in prompts for t in targets]

    run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_root = RUNS_DIR / run_id
    if run_root.exists():
        raise SystemExit(f"error: {run_root} already exists")
    run_root.mkdir(parents=True)
    (run_root / "manifest.json").write_text(json.dumps({
        "run_id": run_id,
        "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "prompts": [p.name for p in prompts],
        "models": [{"provider": t.provider, "model": t.model, "effort": t.effort}
                   for t in targets],
    }, indent=2) + "\n")

    if ENV_PREFIX:
        print("warming nix devShell ...", flush=True)
        subprocess.run([*ENV_PREFIX, "true"], check=True)

    print(f"run {run_id}: {len(prompts)} prompt(s) x {len(targets)} model(s) "
          f"= {len(cells)} cell(s), {jobs} parallel")
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        results = list(pool.map(lambda c: run_cell(c, run_root), cells))

    latest = RUNS_DIR / "latest"
    latest.unlink(missing_ok=True)
    latest.symlink_to(run_id)

    ok = sum(results)
    print(f"run {run_id} complete -> {run_root}")
    print(f"ok: {ok} / {len(cells)} cells; next: /bench-validate {run_id}")
    return 0 if ok == len(cells) else 1


if __name__ == "__main__":
    sys.exit(main())
