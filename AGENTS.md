# Agent Instructions

## Project Overview

`skill-eval` is a portable Claude Code and Codex plugin for evaluating agent skills without installing or mutating the skill under test. Its Bun/TypeScript engine freezes baselines, fixtures, and suites; executes isolated skill snapshots through available hosts; grades outcome and mechanism evidence; runs blind cross-model comparisons; and seals hash-bound evidence claims. The evaluating agent diagnoses failures and advises; the caller owns revisions.

This is a single-package repository. `AGENTS.md` is the canonical repository instruction file; `CLAUDE.md` is a compatibility symlink.

## Repository Layout

- `skills/skill-eval/SKILL.md`: runtime orchestration contract loaded by agent harnesses.
- `skills/skill-eval/scripts/skill-eval.ts`: JSON-emitting CLI entry point.
- `skills/skill-eval/scripts/lib/`: evaluation, execution, grading, review, campaign, and evidence modules.
- `skills/skill-eval/references/`: conditional runtime guidance and isolated agent prompt assets.
- `skills/skill-eval/agents/openai.yaml`: Codex skill-list metadata.
- `tests/`: Bun tests for behavior, integrity boundaries, packaging, and CLI contracts.
- `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/`: Claude and Codex plugin and marketplace metadata.
- `docs/solutions/`: searchable architecture and workflow learnings, organized by category with YAML frontmatter.
- `CONCEPTS.md`: shared vocabulary for evaluation evidence and campaign lifecycle.

## Setup And Validation

Install dependencies:

```bash
bun install --frozen-lockfile
```

Run the complete required validation before committing:

```bash
bun run validate
```

This runs all non-live Bun tests and strict TypeScript checking. Useful focused commands:

```bash
bun test tests/review.test.ts
bun test -t "test name"
bun run typecheck
```

The authenticated cross-host smoke test is intentionally opt-in because it makes real model calls:

```bash
SKILL_EVAL_LIVE=1 bun test tests/live-smoke.test.ts
```

CI runs `bun install --frozen-lockfile` and `bun run validate` on Ubuntu for pushes and pull requests.

## Development Workflow

- Add or update focused tests with every behavioral change. Run the focused test during iteration and `bun run validate` before completion.
- Keep CLI commands machine-readable: successful commands emit JSON to stdout, progress events use stderr JSONL, and failures emit a JSON error.
- Keep `SKILL.md` concise and load-bearing. Put conditional or late-stage detail in a co-located `references/` file and link it from the exact phase that needs it.
- Invoke bundled scripts with the model-filled `SKILL_DIR` anchor documented in `SKILL.md`; do not use host-specific skill-directory variables.
- Keep the distributed skill self-contained. Do not reference files outside `skills/skill-eval/` from runtime skill content.
- Preserve explicit host mappings and immutable artifact paths rather than adding implicit fallback behavior.

## Evaluation Integrity

These are correctness boundaries, not implementation preferences:

- Never install the target skill to evaluate it. Execute frozen snapshots by explicit path in isolated fixtures.
- Keep training and validation evidence separate. Generalization claims require outcome evidence in both partitions.
- Keep the selected fixed anchor immutable. It may be `HEAD`, a branch/PR merge-base, an explicit ref, or no-skill when the target is absent there.
- Never reuse attempt, comparison, feedback, claim, or checkpoint identifiers to overwrite evidence.
- Keep anonymous A/B labels and version mappings separate. Do not expose version identity before a human decision is recorded.
- Treat executor self-report as untrusted. Observable artifacts, transcripts, deterministic checks, and independent judgments provide evidence.
- Human review is display-only in the browser. Collect decisions through the active harness and record one immutable decision per review case.
- Outcome evidence alone can create an effectiveness win. Mechanism evidence can gate a claim but must not inflate pass rates or blind preference.
- The evaluator never edits, commits, promotes, pushes, or merges the target skill.
- Redact credentials before persisting host events, stderr, or final output.

## Code Style

- Use strict TypeScript with explicit interfaces at module boundaries and `.ts` extensions in local imports.
- Prefer small deterministic helpers and structured JSON over ad hoc shell parsing.
- Use Node standard-library APIs supported by Bun. Avoid new runtime dependencies unless they remove substantial complexity and work in installed plugin environments.
- Match the existing formatting: two-space indentation, semicolons in TypeScript, concise comments only for non-obvious invariants.
- Keep tests deterministic and offline by default. Fake host executables belong in tests; real Claude or Codex calls belong only in the opt-in live smoke test.

## Plugin Metadata

When plugin identity, version, description, or user-facing capabilities change, inspect and keep these surfaces consistent:

- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.codex-plugin/plugin.json`
- `.agents/plugins/marketplace.json`
- `skills/skill-eval/agents/openai.yaml`
- `skills/skill-eval/SKILL.md` frontmatter when routing behavior changes

Do not hand-bump versions unless the release task explicitly requires it. Packaging parity is covered by `tests/plugin-contract.test.ts`.

## Pull Requests And Commits

- Use a feature branch and pull request; do not push directly to `main`.
- Use conventional commit messages with a focused scope, such as `feat(review): ...` or `fix(workspace): ...`.
- Keep unrelated refactors out of the change.
- Before pushing, run `bun run validate` and `git diff --check`.
- If CI differs from local results, inspect the failing job before retrying; environment-specific races are evaluation evidence, not noise.
