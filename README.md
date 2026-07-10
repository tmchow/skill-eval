# Skill Eval

Cross-harness evaluation and optimization for agent skills. One portable skill selects the right development baseline and evidence scope, runs resumable immutable attempts through Claude Code and Codex, measures triggering and quality, and promotes only a sealed winner when requested.

`skill-eval` is for developers authoring or revising skills. It evaluates one primary skill at a time; it is not a general skill-writing guide.

Repository files and frozen snapshots are always authoritative. Same-name installed skills are excluded from behavior and trigger executors so an installed release cannot contaminate evaluation of a development checkout.

## Install

Prerequisites:

- macOS, Linux, or WSL
- Bun 1.2+
- Git
- an authenticated Claude Code or Codex CLI

Both hosts are recommended. One authenticated host is sufficient with visibly degraded cross-harness coverage.

### Claude Code

```bash
claude plugin marketplace add tmchow/skill-eval
claude plugin install skill-eval@skill-eval
```

Restart Claude Code after installation.

### Codex

```bash
codex plugin marketplace add tmchow/skill-eval
codex plugin add skill-eval@skill-eval
```

Start a new Codex thread after installation.

## Use

Ask the host to evaluate a named or currently edited skill:

```text
Evaluate the skill revision I am working on and promote it only if the improvement is demonstrated.
```

The workflow:

1. Infers the target and a no-skill, local `HEAD`, explicit-ref, or branch/PR merge-base baseline.
2. Checks dependencies and authentication before expensive calls.
3. Reconstructs the behavioral delta, traces changed mechanisms to their consumed outcomes, and composes focused objective checks with blind quality comparison when both are needed.
4. Summarizes what it will measure, regression coverage, available hosts, and the direct call total in under 180 words; runtime ranges wait for observed calibration.
5. Waits for confirmation.
6. Creates a goal-specific campaign, then freezes realistic agent-designed fixtures, the complete current skill tree, and a fixed Git or no-skill anchor.
7. Compares the baseline and current version on the selected evidence at one repetition, without requiring promotion-only holdouts.
8. Persists and grades each completed behavior or trigger run immediately, then expands only when the claim or observed variance requires it.
9. When improvement was requested, runs or resumes up to five evidence-driven challenger revisions and certifies the winner with training/holdout evidence.
10. When promotion was requested, seals exact benchmark and skill hashes, applies only that winner, and never pushes.

The agent batches routine investigation and keeps process updates value-focused, then summarizes each pass in one short update: outcome, the most important improvement or regression, and the next adjustment. It saves that interpretation as an agent-authored campaign checkpoint, so later runs and context-compacted sessions can recover the reasoning without treating generated prose as objective evidence. Cross-host trigger results and blind judges preserve model-specific disagreement, so pass updates can show when independent models diverge and when a revision produces convergence. Final reports lead with measured before/after results and material coverage limits; they omit dollar-cost estimates and report tokens only when explicitly relevant. A browser review is generated only when agent adjudication genuinely cannot resolve a subjective decision or when requested.

## Evidence And State

Complete run artifacts live outside the target repository:

```text
/tmp/skill-eval/<skill-name>/<run-id>/
```

They include frozen source and fixture hashes, host versions and effective arguments, credential-redacted Claude/Codex JSONL, final messages, outputs, deterministic and transcript-aware grades, anonymous judge rubrics, trigger results, statistical benchmarks, sealed decisions, and promotion backups. Completed behavior and trigger calls survive interruption and are skipped on resume. `status` reports trigger and optimization phases, completed model calls, limits, and recorded usage without making model calls; `status --wait` blocks until the active work completes instead of requiring polling.

Goal-specific campaign manifests and append-only reasoning checkpoints live under `/tmp/skill-eval/<skill-name>/campaigns/`. `campaign-context` assembles linked run facts and checkpoints for an agent to reason over after long runs or context compaction; it does not generate a verdict or final report.

Behavior fixtures may provide executable fake dependencies under `bin/`. Deterministic expectations can assert recorded tool calls directly, including exact invocation counts, without relying on model interpretation of the transcript.

Preflight flags likely unreferenced evaluator specifications inside the target. Confirmed answer-key files can be excluded from executor copies while remaining hash-frozen in source. Deterministic bundled-script contracts can run through `check-script`, producing immutable model-free evidence instead of spending a full behavior call.

Common credential patterns and values from secret-bearing environment variables are redacted before event, stderr, or final-output artifacts are persisted. When anonymous agents cannot resolve a subjective case, a display-only localhost review opens in the available browser and the active harness collects the decision directly; objective and held-out gates still apply.

Long-running comparisons and optimization stay attached to the invoking harness's native background or persistent-command facility. Executor, grader, and judge timeouts are independent, and a timed-out run is reported as inconclusive rather than as evidence of regression.

Calibrated reusable suites may be persisted at:

```text
<target-repository>/.skill-eval/<skill-name>/
```

Generated evals are never stored inside the distributed target skill or copied into executor workspaces.

## Promotion Policy

- Intermediate challengers are never committed.
- Promotion requires an approved decision whose benchmark, winner, suite, fixture, and version hashes still match.
- The sealed winner replaces only the target skill directory.
- Post-run edits to the authored target block promotion instead of being overwritten.
- Repositories that started dirty, untracked targets, default/protected branches, and policy-restricted projects remain uncommitted.
- A clean tracked target on an allowed feature branch may receive one final commit.
- Nothing is pushed automatically.

## Development

```bash
bun install
bun test
bun run typecheck
```

Run authenticated live smoke coverage explicitly:

```bash
SKILL_EVAL_LIVE=1 bun test tests/live-smoke.test.ts
```

The normal test suite uses fake host executables and makes no model calls.

## Attribution

This is a clean-room implementation inspired by the evaluation methodology in Anthropic's Claude Code `skill-creator`, including paired baselines, inspectable artifacts, quantitative grading, and trigger-description evaluation. See [NOTICE](NOTICE) for details.

## License

MIT
