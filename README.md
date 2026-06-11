# llm-bench — an LLM coding benchmark you can actually play

This benchmark asks several LLMs to build the *same* substantial, end-to-end coding
project from one prompt — each working autonomously in its own sandbox — then scores the
results and publishes every artifact as a live, playable web app.

## ▶ Live results

**https://pshirshov.github.io/llm-bench-pi-oneshot/**

That page lists every run; click **▶ play** on any model to run its artifact in your
browser, and open `results.md` for the scored comparison. No build or checkout required.

## What's in it so far

One headline task, **001-rts-wfc** — *"build a complete in-browser Warcraft-2-style RTS
with wave-function-collapse level generation"* — handed to a spread of frontier and open
models (gpt-5.5, grok-build, minimax-m3, glm-5.1, plus a manual Claude Opus / Fable pair).
Every model gets the identical prompt, the same pinned toolchain, and a hard time budget;
nothing is injected into its workspace. The produced games are what you play on the live
site.

## How it works

Each benchmark **prompt** is run across a set of **models** via non-interactive `pi`
instances, in parallel, each in its own isolated `workspace/`.
Results are validated in two passes: an **automated** pass (install / build / typecheck /
lint / test / smoke-serve + a source code review, driven by the `bench-validate` skill)
and a **manual** pass (a human plays the artifact). Scores land in a per-run
`results.md`; the artifacts themselves are built into the live site by
`scripts/build_site.py` and deployed to GitHub Pages.

### Lifecycle

1. **Author** a prompt under `prompts/<id>/` (`PROMPT.md`, `checklist.md`, `meta.json`).
   Prompts pin the toolchain (exact build/lint/test commands) so the automated checklist
   is identical across models — otherwise scores aren't comparable.
2. **Run**: `/bench-run` (or `scripts/run_bench.py`). Every (prompt, model) cell gets a
   fresh empty `workspace/`; `pi` runs non-interactively with the prompt and a per-prompt
   timeout, in parallel up to `-j` (default `nproc`). When `flake.nix` is present, each
   cell runs under `nix develop -c` so models get the pinned toolchain without spending
   turns on environment setup. Workspaces stay pure model output — no files are injected.
3. **Validate (automated)**: `/bench-validate [run-id]` executes each prompt's "Automated"
   checklist inside every workspace, performs the "Code review" section, and writes a
   scored comparison table to `runs/<run-id>/results.md`.
4. **Validate (manual)**: a human runs each surviving artifact (`npm run dev`), checks the
   "Manual" items, and records verdicts in `results.md`.
5. **Publish**: `scripts/build_site.py [run-id ...]` builds every produced project
   (`vite build --base=./`, bypassing `tsc` so a type error still yields a runnable
   bundle), copies each `dist/` into `site/<run>/<prompt>/<model>/`, and writes
   `site/index.html` linking every playable artifact. With no run id it builds every run
   under `runs/`. The `publish-site.yml` workflow runs this on pushes to `main` that touch
   `runs/` and deploys `site/` to GitHub Pages; a model that ships a broken project is
   listed as failed in the index rather than blocking the deploy.

### Scoring

- **Automated** items: pass = 1, fail = 0. A failed install/build gates the rest (recorded
  as 0 but still code-reviewed — a near-working artifact is informative).
- **Code-review** items: 0–2 each (absent / superficial / genuine), judged from source.
- **Manual** items: pass = 1, fail = 0, filled in by a human.
- `results.md` reports per-section subtotals and a total per model — no weighting magic,
  the raw table is the deliverable.

## Repository layout

```
├── bench.toml                 config: [defaults] (jobs, timeout) + [[models]] targets
│                              (provider, model, optional effort = pi thinking level)
├── flake.nix / flake.lock     pinned toolchain (node, python, git, jq) for cells,
│                              validation, and the runner itself
├── mcp.bench.json             empty MCP server set passed to every cell: keeps cq tools
│                              (codegraph/ledger) out of the benchmark
├── prompts/<id>/
│   ├── PROMPT.md              the exact prompt handed to pi
│   ├── checklist.md           validation checklist (automated / code-review / manual)
│   └── meta.json              { id, title, timeout_seconds }
├── scripts/
│   ├── run_bench.py           parallel runner (prompts × models matrix; Python 3.11+ stdlib)
│   └── build_site.py          builds run artifacts into the playable static site
├── .github/workflows/
│   └── publish-site.yml       builds + deploys the site to GitHub Pages
├── runs/<run-id>/             committed — the produced artifacts the live site is built from
│   ├── manifest.json          run id, started_at, prompts, models
│   ├── results.md             scored comparison, written by bench-validate
│   └── <prompt-id>/<model-slug>/
│       ├── workspace/         pi's cwd — the produced project lives here
│       ├── session/           pi session files (full transcript)
│       ├── pi.log / pi.err     pi stdout / stderr
│       └── meta.json          { model, exit_code, status, duration_seconds, ... }
└── .claude/skills/
    ├── bench-run/             /bench-run — launch a run, monitor, report completion
    └── bench-validate/        /bench-validate — automated checklist pass + results.md
```

## Authoring guidelines for new prompts

- One self-contained deliverable in an empty directory; no network resources beyond the
  npm registry.
- State operational acceptance criteria (exact commands that must exit 0), not vibes.
- Pin: language + strict mode, build tool, test runner, allowed dependencies.
- Require a seeded PRNG where randomness exists — makes manual validation reproducible.
- Mirror every requirement in `checklist.md`; a requirement without a checklist item will
  not be scored.

## Building the site locally

```sh
scripts/build_site.py            # build every run under runs/ into ./site
scripts/build_site.py <run-id>   # or a specific run
python3 -m http.server -d site   # then open http://localhost:8000
```

> The site deploy needs **Settings → Pages → Source: "GitHub Actions"** enabled once.
