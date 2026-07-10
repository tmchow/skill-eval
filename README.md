# Skill Eval

Cross-harness evaluation and optimization for agent skills. One portable skill runs immutable baseline and candidate attempts through Claude Code and Codex, enforces training/holdout evidence, grades qualitative outputs anonymously, measures triggering and cost, and promotes only a sealed winner.

`skill-eval` is for developers authoring or revising skills. It evaluates one primary skill at a time; it is not a general skill-writing guide.

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

1. Infers the target and baseline.
2. Checks dependencies and authentication before expensive calls.
3. Summarizes what it will measure, regression coverage, available hosts, and expected cost/time.
4. Waits for confirmation.
5. Freezes realistic agent-designed fixtures, explicit training/holdout partitions, and a fixed Git or no-skill anchor.
6. Calibrates the suite, then runs immutable attempts without installing the target skill.
7. Grades objective facts mechanically, qualitative expectations from anonymous transcripts, and comparative quality with repetition-aware blind judges.
8. Runs or resumes up to five evidence-driven challenger revisions, injecting the current host's `skill-creator` instructions when available.
9. Selects description improvements by held-out trigger score, then certifies the full behavior suite again.
10. Seals exact benchmark and skill hashes into a promotion decision, applies only that winner, and never pushes.

The agent summarizes each pass in one short update: outcome, the most important improvement or regression, and the next adjustment. A browser review is generated only when agent adjudication genuinely cannot resolve a subjective decision or when requested.

## Evidence And State

Complete run artifacts live outside the target repository:

```text
/tmp/skill-eval/<skill-name>/<run-id>/
```

They include frozen source and fixture hashes, host versions and effective arguments, credential-redacted Claude/Codex JSONL, final messages, outputs, deterministic and transcript-aware grades, anonymous judge rubrics, trigger results, statistical benchmarks, sealed decisions, and promotion backups.

Common credential patterns and values from secret-bearing environment variables are redacted before event, stderr, or final-output artifacts are persisted. When anonymous agents cannot resolve a subjective case, a display-only localhost review opens in the available browser and the active harness collects the decision directly; objective and held-out gates still apply.

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
