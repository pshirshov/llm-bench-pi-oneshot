---
name: bench-run
description: Launch an LLM benchmark run — execute benchmark prompt(s) across the configured pi models in parallel isolated workdirs via scripts/run_bench.py, monitor progress, and report completion. Use when the user says /bench-run or asks to run/start the benchmark. Args (all optional): prompt ids, model overrides as provider/model[@effort], -j N.
---

# bench-run

Launch and supervise one benchmark run. The mechanics live in
`scripts/run_bench.py`; this skill's job is argument translation, supervision,
and a faithful completion report. Read `README.md` at the repo root for the
layout if anything below is surprising.

## Procedure

1. **Translate args.** Map the user's request onto script flags:
   - prompt ids (e.g. `001-rts-wfc`) → repeated `-p <id>`; none → all prompts.
   - model overrides → repeated `-m 'provider/model[@effort]'`; none → `bench.toml`.
   - explicit parallelism → `-j N`; timeout override → `-t seconds`.
   Before launching, echo the resolved matrix (prompts × models, timeouts) in one
   short paragraph so the user sees what is about to burn tokens. If `bench.toml`
   is missing or empty and no `-m` was given, stop and ask.

2. **Launch in background.** Run `scripts/run_bench.py <flags>` with the Bash tool,
   `run_in_background: true`. Runs are long (the RTS prompt allows 3h per cell);
   never run it in the foreground.

3. **Monitor.** When notified of completion (or when the user asks for status),
   read the script output and `runs/<run-id>/*/*/meta.json`. Mid-run status =
   count of `[done ]` lines vs total cells.

4. **Report.** On completion, summarize per cell: status (ok / timeout / error),
   duration, and workspace size (`du -sh`). Quote `pi.err` tails for failed cells.
   Do NOT start validating — point the user at `/bench-validate <run-id>` instead.

## Guardrails

- Never delete or rerun into an existing `runs/<run-id>` directory.
- Do not edit `bench.toml` silently; propose changes and let the user confirm.
- If `pi` exits non-zero instantly across all cells, suspect harness/config
  (provider auth, model name) rather than the prompts — check `pi.err` first and
  surface the finding instead of retrying blindly.
