# bench — LLM coding benchmark suite over the pi harness

Benchmarks LLMs on substantial, end-to-end coding tasks. Each benchmark *prompt* is run
across a set of *models* via non-interactive `pi` instances, in parallel, each in its own
isolated working directory. Results are then validated in two passes: an automated pass
(driven by the `bench-validate` Claude skill) and a manual pass (the user plays/inspects
the artifact).

## Layout

```
bench/
├── README.md                  this file
├── bench.toml                 config: [defaults] (jobs, timeout) + [[models]] targets
│                              (provider, model, optional effort = pi thinking level)
├── flake.nix / flake.lock     pinned toolchain (node, python, git, jq) for cells,
│                              validation, and the runner itself
├── mcp.bench.json             empty MCP server set passed to every cell via
│                              --mcp-config: keeps cq tools (codegraph/ledger) out of
│                              the benchmark and stops ledger-mcp from scaffolding
│                              docs/ into workspaces
├── .envrc                     direnv: `use flake` — also covers nested workspaces
├── prompts/
│   └── <id>/                  one directory per benchmark prompt
│       ├── PROMPT.md          the exact prompt handed to pi
│       ├── checklist.md       validation checklist (automated / code-review / manual)
│       └── meta.json          { id, title, timeout_seconds }
├── scripts/
│   ├── run_bench.py           parallel runner (prompts × models matrix; Python 3.11+ stdlib)
│   └── build_site.py          builds run artifacts into a static site + index.html
├── .github/workflows/
│   └── publish-site.yml       builds + deploys the site to GitHub Pages
├── runs/                      (gitignored) one directory per run
│   └── <run-id>/
│       ├── manifest.json      run id, started_at, prompts, models
│       ├── results.md         written by bench-validate
│       └── <prompt-id>/<model-slug>/
│           ├── workspace/     pi's cwd — the produced project lives here
│           ├── session/       pi session files (full transcript, exportable to HTML)
│           ├── pi.log         pi stdout
│           ├── pi.err         pi stderr
│           └── meta.json      { model, exit_code, status, duration_seconds, ... }
└── .claude/skills/
    ├── bench-run/             /bench-run — launch a run, monitor, report completion
    └── bench-validate/        /bench-validate — automated checklist pass + results.md
```

## Lifecycle

1. **Author** a prompt: `prompts/<id>/{PROMPT.md,checklist.md,meta.json}`.
   Prompts must pin the toolchain (build/lint/test commands) so the automated
   checklist is identical across models — otherwise scores are not comparable.
2. **Run**: `/bench-run` (or `scripts/run_bench.py` directly). Every (prompt, model)
   cell gets a fresh empty `workspace/`; pi runs `--print` with the prompt text and a
   per-prompt timeout. Cells execute in parallel up to `-j` (default `nproc`).
   When `flake.nix` is present at the bench root, each cell (and the devShell warm-up
   before fan-out) runs under `nix develop <bench-root> -c`, so models get the pinned
   toolchain without spending turns on environment setup; prompts must tell them so.
   Workspaces themselves stay pure model output — no files are injected.
3. **Validate (automated)**: `/bench-validate [run-id]` — Claude executes the
   "Automated" section of each prompt's checklist inside each workspace
   (install, build, typecheck, lint, test, smoke-serve), performs the
   "Code review" section, and writes a scored comparison table to
   `runs/<run-id>/results.md`, leaving the "Manual" section as an unchecked
   list per cell.
4. **Validate (manual)**: the user runs each surviving artifact (`npm run dev` in the
   workspace), checks the "Manual" items, and records verdicts in `results.md`.
5. **Publish**: `scripts/build_site.py [run-id ...]` builds every produced project
   (`vite build --base=./`, bypassing `tsc` so a type error still yields a runnable
   bundle), copies each `dist/` into `site/<run>/<prompt>/<model>/`, and writes
   `site/index.html` linking every playable artifact (grouped by run, with the run's
   `results.md` alongside). With no run id it builds every run under `runs/`.
   The `publish-site.yml` workflow runs this on pushes to `main` that touch `runs/`
   and deploys `site/` to GitHub Pages; partial build failures are listed in the
   index rather than blocking the deploy.

## Scoring

- Automated items: pass = 1, fail = 0. A failed install/build gates the rest (recorded
  as 0 but still code-reviewed — a near-working artifact is informative).
- Code-review items: 0–2 each (absent / superficial / genuine), judged from source.
- Manual items: pass = 1, fail = 0, filled in by the user.
- `results.md` reports per-section subtotals and a total per model; no weighting magic —
  the raw table is the deliverable.

## Authoring guidelines for new prompts

- One self-contained deliverable in an empty directory; no network resources beyond
  npm registry.
- State operational acceptance criteria (exact commands that must exit 0), not vibes.
- Pin: language + strict mode, build tool, test runner, allowed dependencies.
- Require a seeded PRNG where randomness exists — makes manual validation reproducible.
- Mirror every requirement in `checklist.md`; a requirement without a checklist item
  will not be scored.
