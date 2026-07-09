# Skill Eval Superset Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven development for each task and verification-before-completion before shipping.

**Goal:** Make `skill-eval` a trustworthy superset of the evaluation capabilities in Claude Code's official `skill-creator`, while retaining cross-harness execution and agent-first adjudication.

**Architecture:** Keep the portable Bun engine, but replace advisory workflow claims with immutable run attempts, enforced evidence partitions, machine-owned decisions, and resumable optimization state. Deterministic checks remain authoritative for objective facts; host graders and judges add transcript-aware qualitative evidence. Promotion consumes a sealed decision artifact rather than an arbitrary version name.

**Tech Stack:** Bun 1.2+, TypeScript, Claude Code CLI, Codex CLI, static HTML, Git.

## Global Constraints

- Keep generated suites and run artifacts outside distributed target skills.
- Run the same skill bytes on Claude Code and Codex; missing secondary coverage degrades confidence rather than blocking the invoking host.
- Never expose held-out prompts, fixtures, expectations, or results to a reviser.
- Never install, authenticate, commit, or push silently.
- Preserve zero third-party runtime dependencies beyond Bun, Git, and selected host CLIs.
- Keep the review UI on demand; do not restore browser-first review.

---

### Task 1: Immutable Attempts And Enforced Partitions

**Files:**
- Modify: `skills/skill-eval/scripts/lib/types.ts`
- Modify: `skills/skill-eval/scripts/lib/executor.ts`
- Modify: `skills/skill-eval/scripts/lib/triggers.ts`
- Modify: `skills/skill-eval/scripts/skill-eval.ts`
- Test: `tests/executor.test.ts`
- Test: `tests/triggers.test.ts`

- [ ] Add immutable attempt IDs, timestamps, partition metadata, model metadata, and per-run metrics to execution and trigger records.
- [ ] Filter behavior and trigger cases by `training`, `holdout`, or explicit IDs; default optimization-facing commands to training evidence.
- [ ] Store each invocation under an attempt-specific directory and reject attempt-ID reuse.
- [ ] Run focused tests and verify reruns preserve prior artifacts without duplicate indexes.

### Task 2: Statistical Benchmarking And Sealed Decisions

**Files:**
- Modify: `skills/skill-eval/scripts/lib/benchmark.ts`
- Create: `skills/skill-eval/scripts/lib/decision.ts`
- Modify: `skills/skill-eval/scripts/lib/assertions.ts`
- Modify: `skills/skill-eval/scripts/lib/promotion.ts`
- Test: `tests/benchmark.test.ts`
- Test: `tests/promotion.test.ts`

- [ ] Make process failure, timeout, malformed completion, source mutation, and critical-case failure automatic critical gates.
- [ ] Aggregate mean, sample standard deviation, min, max, per-case stability, cost, tool calls, errors, and skill bytes by partition.
- [ ] Create a sealed decision that requires complete training and held-out coverage, fixed-anchor and incumbent comparisons, critical gates, minimum effect or preference evidence, and snapshot hashes.
- [ ] Require the sealed decision and winner hash during promotion; reject arbitrary versions and stale evidence.

### Task 3: Transcript-Aware Grading And Analysis

**Files:**
- Create: `skills/skill-eval/scripts/lib/model-grader.ts`
- Create: `skills/skill-eval/scripts/lib/analyzer.ts`
- Modify: `skills/skill-eval/scripts/lib/judges.ts`
- Modify: `skills/skill-eval/scripts/lib/types.ts`
- Test: `tests/model-grader.test.ts`
- Test: `tests/analyzer.test.ts`
- Test: `tests/judges.test.ts`

- [ ] Grade unsupported qualitative expectations against anonymous transcripts and artifacts with structured evidence and blocked states.
- [ ] Extract claims, instruction-following failures, superficial assertions, non-discriminating checks, flaky cases, and resource tradeoffs.
- [ ] Judge every selected repetition with a task-specific structured rubric and immutable comparison IDs.
- [ ] Keep executor, version, and label identity hidden until each judge exits.

### Task 4: Automated Behavior And Description Optimization

**Files:**
- Create: `skills/skill-eval/scripts/lib/optimizer.ts`
- Create: `skills/skill-eval/scripts/lib/description-optimizer.ts`
- Modify: `skills/skill-eval/scripts/lib/skill.ts`
- Modify: `skills/skill-eval/scripts/lib/workspace.ts`
- Modify: `skills/skill-eval/scripts/skill-eval.ts`
- Test: `tests/optimizer.test.ts`
- Test: `tests/description-optimizer.test.ts`

- [ ] Add resumable optimization state with a hard five-challenger limit and explicit stop reasons.
- [ ] Give revisers only generalized training evidence; validate and hash each isolated challenger.
- [ ] Require challengers to clear training, held-out, fixed-anchor, and incumbent gates before becoming incumbent.
- [ ] Add stratified trigger partitions, three-run query stability, host-parallel probing, automated description proposals, and best-by-held-out selection.
- [ ] Emit one concise progress event per pass for the invoking agent to summarize.

### Task 5: Review And Authoring Surfaces

**Files:**
- Modify: `skills/skill-eval/scripts/lib/review.ts`
- Create: `skills/skill-eval/scripts/lib/eval-review.ts`
- Test: `tests/review.test.ts`
- Test: `tests/eval-review.test.ts`

- [ ] Generate a static review page with anonymous outputs, text/image/PDF/XLSX rendering, benchmark evidence, agent judgments, and structured feedback export.
- [ ] Generate an optional suite-review page for editing trigger labels and reviewing behavior-case purposes and expectations before freezing.
- [ ] Keep both pages static and unopened unless the user explicitly requests them or agent adjudication remains unresolved.

### Task 6: Reproducibility, Host Metrics, And Runtime Contract

**Files:**
- Modify: `skills/skill-eval/scripts/lib/hosts.ts`
- Modify: `skills/skill-eval/scripts/lib/preflight.ts`
- Modify: `skills/skill-eval/scripts/lib/workspace.ts`
- Modify: `tests/hosts.test.ts`
- Modify: `tests/preflight.test.ts`
- Modify: `tests/live-smoke.test.ts`

- [ ] Pin optional executor/judge/reviser models, record host versions and effective arguments, and parse tool calls, steps, errors, tokens, cost, and malformed events.
- [ ] Revalidate frozen suite, fixture, and version hashes before every phase.
- [ ] Test host argument contracts with fake binaries and run authenticated local Claude/Codex smoke coverage.

### Task 7: Runtime Skill, Documentation, And Final Evaluation

**Files:**
- Modify: `skills/skill-eval/SKILL.md`
- Modify: `skills/skill-eval/references/*.md`
- Modify: `README.md`
- Modify: `tests/skill-contract.test.ts`
- Modify: `tests/cli.test.ts`

- [ ] Replace manual phase choreography with the resumable commands and concise progress contract.
- [ ] Document enforced holdouts, decision sealing, metrics, review escalation, and promotion behavior without overstating unavailable native capabilities.
- [ ] Run the full deterministic suite, typecheck, plugin validators, authenticated live smoke, and a fresh current-source skill evaluation.
- [ ] Obtain independent Claude and Cursor reviews, resolve material findings, commit, push, and update the existing PR.
