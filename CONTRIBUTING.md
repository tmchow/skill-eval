# Contributing to Skill Eval

Bug reports and pull requests are welcome. Acceptance is selective: a change must fit the project's direction, preserve its evaluation trust boundaries, and justify the maintenance it introduces. Sound work may still be declined because it is outside the intended scope or maintenance model. No hard feelings either way.

## Report a Bug

Use the [bug report form](https://github.com/tmchow/skill-eval/issues/new?template=bug_report.yml). A focused reproduction is valuable even without a proposed fix.

Include:

- what happened and what you expected;
- the smallest reliable reproduction;
- the affected skill development state: new, locally edited, committed branch, or PR;
- relevant host and environment versions;
- sanitized run or campaign artifacts when they help establish the failure.

Harness, model, and reasoning-setting details are required only when the bug concerns model behavior, triggering, grading, judging, or cross-host differences. They are optional for deterministic crashes, packaging errors, and similar defects. Never submit credentials, hidden chain-of-thought, or an unredacted private transcript.

## Propose a Change

Use the [feature request form](https://github.com/tmchow/skill-eval/issues/new?template=feature_request.yml) for substantial new behavior. Small, well-bounded fixes may go directly to a pull request.

Before implementing a larger change, establish:

1. the developer problem and desired outcome;
2. why the current workflow cannot address it;
3. the smallest coherent scope;
4. how success and regressions can be measured.

## AI-Assisted Work

AI-assisted contributions should use a strong reasoning model appropriate to the work, such as Fable, Opus, GPT-5.6 Sol, or a comparably capable model. Model capability does not substitute for reviewing the complete diff, testing failure paths, or owning the submitted work.

When AI materially contributed to a pull request, disclose:

- the harness and its version;
- the exact model identifier when available;
- the visible reasoning setting (`high`, `xhigh`, extended thinking, default, or `not exposed`);
- whether AI was used for implementation, tests, review, eval design, or debugging;
- any independent model or human review that changed the result.

Do not provide hidden chain-of-thought. Reasoning effort means only the setting exposed by the harness. `Unknown` and `not exposed` are valid when accurate. For mechanical changes where AI assistance was immaterial, say `Not material`.

Generated code that has only been prompted into existence is not ready for review. Resolve the findings you would raise in a serious code review before opening the pull request.

## Development Setup

```bash
git clone https://github.com/tmchow/skill-eval.git
cd skill-eval
bun install
bun run validate
```

The normal suite uses fake host executables and makes no model calls. Authenticated live smoke coverage is opt-in:

```bash
SKILL_EVAL_LIVE=1 bun test tests/live-smoke.test.ts
```

## Engineering Boundaries

Changes must preserve these contracts:

- **Adaptive reasoning belongs to the agent.** The engine collects and verifies facts; it does not generate the final evaluation verdict.
- **Repository source is authoritative.** Installed same-name skills must not contaminate evaluation of a development checkout.
- **Evidence is immutable and partitioned.** Attempts, identities, hashes, and held-out boundaries must fail closed when incomplete or inconsistent.
- **Claims require matching evidence.** Deterministic mechanisms, qualitative outcomes, triggering, and cross-host portability are different claims.
- **Promotion is conservative.** Only a sealed, revalidated winner may be applied, and Skill Eval never pushes.
- **Persisted evidence is sanitized.** Credentials and secret-bearing environment values must be redacted before storage.

## Validation by Change Type

| Change | Minimum evidence |
|---|---|
| Documentation or metadata | Review rendered structure, run `git diff --check`, and run contract tests affected by the change |
| Deterministic engine behavior | Focused regression test plus `bun run validate` |
| Skill prose or evaluation behavior | Baseline/current scenarios, regression coverage, and the measured result; use both model hosts when the portability claim requires them |
| Host process, timeout, resume, or promotion logic | Success, interruption, and failure-path tests plus `bun run validate` |
| Review UI | Server tests and visual verification of representative long and short artifacts |

Run live Claude Code/Codex coverage when a change materially affects real host invocation or discovery and you have the required authentication. If you cannot run it, state that limitation rather than implying coverage.

## Pull Request Standard

Use the pull request template and keep the submission focused. A reviewable PR explains:

- the problem and intended outcome;
- what changed and what intentionally did not;
- evidence that the change works;
- tests and important failure paths exercised;
- risks, limitations, and unresolved questions;
- material AI assistance and independent review.

For skill-behavior changes, include the baseline, scenarios, before/after measurements, consequential cross-model agreement or disagreement, and what the eval did not establish. Screenshots and logs are supporting evidence, not substitutes for a reproducible test.

By submitting a pull request, you acknowledge that it may be declined or independently reimplemented even when technically sound.
