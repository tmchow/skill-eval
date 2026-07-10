---
title: Separate adaptive orchestration from deterministic cross-harness evaluation
date: 2026-07-10
category: architecture-patterns
module: skill-eval
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - One portable skill evaluates behavior across agent harnesses with different lifecycle primitives
  - Long-running stochastic evaluations must survive interruption without losing trustworthy evidence
  - Promotion must depend on reproducible artifacts rather than executor self-report
tags:
  - cross-harness
  - skill-evaluation
  - immutable-evidence
  - resumable-evaluation
  - promotion-gates
---

# Separate adaptive orchestration from deterministic cross-harness evaluation

## Context

Long-running skill evaluation fails when three contracts drift apart: the claim being evaluated, the evidence mode selected for that claim, and the execution lifecycle used to collect the evidence. A deterministic check can prove that a mechanism ran while saying nothing about whether the user's outcome improved. A promotion pipeline can be correct yet waste calls if it discovers promotion preconditions late. A resumable engine can still repeat paid work if its manifest and durable record ledger disagree after a hard kill.

Anthropic's `skill-creator` supplied useful methodological precedent: inject current source instead of installing it, compare paired outputs, grade observable artifacts, and use blind qualitative judgment. A portable Claude Code and Codex evaluator also needs explicit baseline semantics, held-out isolation, host-specific job supervision, incremental durability, and a machine-verifiable promotion boundary.

## Guidance

### Derive the outcome before choosing evidence

Trace the change from mechanism to immediate effect to consumed output to terminal benefit. The primary claim belongs at the last link the user or downstream consumer values. Routing, tool invocation, artifact creation, provenance, and fold-in are supporting claims unless the user explicitly asks about those mechanics.

Use this counterfactual before preparing cases:

> Could every mechanism check pass while the intended consumer benefit remains absent?

If yes, add an outcome case. Confirming that a second reviewer ran proves orchestration; it does not prove that the final review found more material issues without unacceptable noise. The runtime contract makes this distinction explicit and requires a case that fails when the benefit is absent even though the mechanism works ([SKILL.md](../../../skills/skill-eval/SKILL.md#outcome-sufficiency-gate), lines 65-88).

Compose evidence rather than substituting one kind for another:

- Trigger claims use realistic positive and adjacent-negative discovery queries.
- Inspectable files, schemas, commands, and side effects use deterministic checks.
- Output-quality claims use paired anonymous comparison with objective regression checks.
- Broad end-to-end claims use the smallest branch-complete suite that preserves the causal path.

Run baseline and current versions on the same representative environment. A current-only smoke test proves operability, not improvement. A fake dependency may prove routing or fallback behavior, but it cannot replace the component claimed to create the outcome benefit.

### Separate comparison from certification

Evaluation-only comparison and promotion are different decisions.

`compare` requires a training case, distinct versions, and valid hosts before execution. It runs the training partition, grades it, performs blind paired judgment, and builds a comparison-scoped benchmark without sealing a promotable decision ([comparison.ts](../../../skills/skill-eval/scripts/lib/comparison.ts), lines 28-76).

`certify` requires both training and held-out behavior cases before allocating attempts or calling a model. It evaluates both partitions and only then tries to seal a decision ([optimizer.ts](../../../skills/skill-eval/scripts/lib/optimizer.ts), lines 148-208).

Use the narrowest valid path:

- `run` plus `grade` for focused objective behavior.
- `compare` for paired quality or evaluation-only calibration.
- `certify` only when promotion is in scope and both evidence partitions exist.

This avoids paying for a training matrix only to discover that a deliberately focused suite has no promotion holdout.

### Fail fast and classify missing evidence honestly

Every precondition that can be checked without a model should fail before the first model call: partition coverage, distinct and existing versions, nonempty host sets, dependencies, authentication, and bounded command probes.

After execution, a timeout is inconclusive rather than a regression. A failed baseline is also inconclusive; otherwise its artificial zero score can manufacture an improvement. Benchmark gates block either-side timeouts, baseline execution failure, candidate execution failure, and candidate critical failure before computing a verdict ([benchmark.ts](../../../skills/skill-eval/scripts/lib/benchmark.ts), lines 185-240).

Blind preferences must belong to the exact judgment batch that produced them. When more than one compatible batch exists, benchmark construction requires an explicit comparison ID instead of aggregating stale judgments.

### Let the host supervise the outer job

The invoking harness owns launch, waiting, cancellation, and completion notification for the outer Bun command. The engine owns frozen inputs, subprocesses, artifacts, manifests, resume, and model-free status.

Claude Code should use background Bash and native monitoring. Codex should keep the command attached to a persistent exec session. Both can read durable behavior-attempt progress with `status`; the attached host command remains the completion authority for later grading, judging, and benchmarking phases. Do not add `nohup`, `setsid`, or another `&` layer: a wrapper may exit while the real evaluator is still running ([hosts.md](../../../skills/skill-eval/references/hosts.md), lines 5-12).

Timeouts follow phase cost, not one global ceiling. Executors need room for nested agents and cleanup; graders and judges are shorter; revisers may need longer editing time. A timeout ceiling is not a runtime estimate. Independent executor, grader, and judge calls use bounded concurrency so long evaluations overlap safely without unbounded fan-out.

### Persist each arm and reconcile crash skew

Each completed execution is a durability unit. Persist its execution record and deterministic grade immediately, then resume only keys that are missing. Reconstruct completed work from the aggregate ledger and per-arm artifacts.

Do not require the attempt manifest counter to equal the durable record count. A hard kill can land after `executions.json` is durable but before `attempt.json` advances. A started or interrupted attempt is reusable when:

```text
manifest.record_count <= durable_records <= manifest.planned_records
```

That predicate is enforced in [artifacts.ts](../../../skills/skill-eval/scripts/lib/artifacts.ts), lines 21-35. Status reports the greater durable count and marks an abandoned attempt `superseded` when a completed retry exists ([status.ts](../../../skills/skill-eval/scripts/lib/status.ts), lines 33-64).

### Keep model-visible identity opaque and engine identity unique

Graders, judges, and revisers operate in temporary workspaces outside the main run directory. They receive only the evidence needed for one task. Anonymous A/B paths and hashed scratch identities reduce version leakage; held-out prompts and results stay outside revision feedback.

Opacity does not replace uniqueness. Engine archive keys must include every distinguishing dimension: attempt, case, executor host, version, repetition, and grader host. Model-grader archives include the version even though the model-facing scratch path uses an opaque execution hash ([model-grader.ts](../../../skills/skill-eval/scripts/lib/model-grader.ts), lines 67-105).

Use frozen fixture-backed script probes for deterministic bundled-script contracts. They run in a separate copied workspace, receive the frozen skill through `SKILL_DIR`, prepend fixture-local fake CLIs to `PATH`, fail on mutation or timeout, and persist their evidence ([script-checks.ts](../../../skills/skill-eval/scripts/lib/script-checks.ts), lines 48-117). These probes prove mechanism behavior, not subjective output quality.

## Why This Matters

The combined pattern turns a fragile command chain into a restartable evidence state machine:

- Outcome-first claim design prevents green wiring checks from masquerading as user benefit.
- Compare/certify separation avoids unnecessary model spend and promotion-shaped overclaims.
- Exact evidence scoping prevents prior runs or judgments from contaminating a verdict.
- Host-native supervision avoids false completion from detached wrappers.
- Incremental persistence limits interruption loss to the currently in-flight arms, bounded by configured concurrency.
- Opaque workspaces protect blindness and held-out evidence while injective archive keys prevent collisions.
- Fail-closed grading and sealed decisions keep executor self-report out of the trust boundary.

## When to Apply

- A skill change claims better output quality but is implemented through routing, orchestration, tool selection, or reference loading.
- Evaluation may exceed the host's foreground command window.
- Training and held-out evidence have different disclosure rules.
- Retries must preserve already-paid model work.
- Claude Code and Codex must evaluate the same frozen skill with different process primitives.
- Promotion must be reproducible from immutable evidence rather than a prose summary.

Use a narrower path when the claim is narrower. Trigger discovery does not need behavior execution. A deterministic routing contract may stop at `check-script`, `run`, and `grade`. A quality claim needs paired outcome comparison. Promotion adds holdout and certification only when requested.

## Examples

### Mechanism plus outcome

```text
Primary outcome: the final review finds more material defects without materially increasing noise.
Mechanism check: structured events show exactly one cross-model reviewer call.
Outcome check: blind judges compare baseline/current reviews on issue coverage, correctness, and noise.
Regression checks: no duplicate findings, unrelated expansion, or change to the normal path.
```

### Evaluation-only versus promotion-grade

```bash
# Directional calibration: training evidence only, no sealed decision.
bun "$SKILL_DIR/scripts/skill-eval.ts" compare \
  --run-dir "$RUN_DIR" --left anchor --right authored \
  --label calibration --hosts claude,codex --judge-hosts claude,codex \
  --repetitions 1 --executor-timeout-ms 1800000

# Promotion gate: the frozen suite must contain training and held-out cases.
bun "$SKILL_DIR/scripts/skill-eval.ts" certify \
  --run-dir "$RUN_DIR" --candidate authored --incumbent anchor \
  --label final --hosts claude,codex --judge-hosts claude,codex \
  --repetitions 3 --executor-timeout-ms 1800000
```

### Recoverable manifest skew

```text
executions.json records: 7
attempt.json record_count: 6
attempt.json planned_records: 10
attempt status: started
```

This is resumable, not corrupt. Reconstruct the seven durable keys and execute only the remaining three arms.

## Related

- [Cross-harness skill eval design](../../plans/2026-07-09-cross-harness-skill-eval-design.md)
- [Cross-harness skill eval implementation](../../plans/2026-07-09-cross-harness-skill-eval-implementation.md)
- [Superset remediation plan](../../plans/2026-07-09-skill-eval-superset-remediation.md)
