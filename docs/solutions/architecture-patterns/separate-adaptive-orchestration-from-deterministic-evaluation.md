---
title: Separate adaptive interpretation from deterministic skill evidence
date: 2026-07-10
last_updated: 2026-07-12
category: architecture-patterns
module: skill-eval
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - One portable skill evaluates behavior across agent harnesses
  - Long stochastic evaluations must survive interruption
  - Advice must remain distinct from reproducible evidence
tags:
  - cross-harness
  - skill-evaluation
  - immutable-evidence
  - resumable-evaluation
  - claim-validity
  - source-isolation
---

# Separate adaptive interpretation from deterministic skill evidence

## Context

Skill evaluation fails when the claim, evidence mode, or counterfactual drifts. A deterministic check can prove a mechanism ran while saying nothing about whether the user's result improved. A current-only smoke test can prove operability while saying nothing about whether a new skill earns its keep. An auto-revision loop can also blur roles: the same system that designed the test, edited the treatment, and selected the winner has too many opportunities to move the goalposts.

Anthropic's `skill-creator` supplied useful methodology: inject current source instead of installing it, compare paired outputs, grade observable artifacts, and use blind qualitative judgment. A portable Claude Code and Codex evaluator additionally needs explicit baseline semantics, host-specific supervision, source-identity enforcement, incremental durability, and a clear evaluator/author boundary.

The durable architecture is therefore:

- the engine freezes and indexes facts;
- the evaluation agent designs scenarios, interprets evidence, and advises;
- the caller or authoring workflow edits the target;
- a later eval tests the edited source against the same goal and fixed anchor.

## Guidance

### Derive the terminal outcome first

Trace the change from mechanism to immediate effect to consumed output to the benefit a user or downstream agent values. Ask:

> Could every mechanism check pass while the intended consumer benefit remains absent?

If yes, the outcome layer is missing. A cross-model call, folded finding, or generated artifact can establish causality, but not improved review, planning, writing, or decision quality.

Compose evidence instead of substituting it:

- trigger claims use realistic positive and adjacent-negative queries;
- inspectable files, schemas, commands, and side effects use deterministic checks;
- quality claims use paired anonymous comparison;
- downstream usability uses a fresh consumer only when that is the confirmed benefit.

### Make evidence roles executable

Every expectation is either `outcome` or `mechanism`.

Outcome evidence alone can contribute positive pass-rate, qualitative preference, and effectiveness evidence. Mechanism evidence can explain a causal path and a critical failure can block success, but a passing mechanism cannot manufacture an improvement. This rule belongs in benchmark, grader, and judge code rather than relying on report prose.

Claim classes limit conclusions:

- **Conformance** validates a trigger, route, gate, format, or fallback.
- **Effectiveness** requires paired current/anchor outcome evidence.
- **Generalization** additionally requires outcome evidence in training and separate validation situations.

For a new skill, the anchor is normal no-skill behavior. Authored-only evidence never establishes improvement.

### Critique measurement design before outputs

The orchestrator that inferred the change may design scenarios around its own assumptions. An independent critic should inspect the frozen skill, baseline, fixtures, hypothesis, and expectations before effectiveness execution. It tests whether the scenarios discriminate the terminal benefit, preserve constitutive context, resist superficial checks, and project treatment identity symmetrically.

Critics advise; the confirmed campaign goal remains scope authority. A critical issue cannot be waived as a limitation. An accepted issue requires a replacement immutable run. Do not rerun critics until one agrees.

### Preserve the counterfactual across development states

The current arm is always the repository target's current bytes, whether uncommitted, committed, pushed, or mixed. The anchor is selected independently: `HEAD` for local edits, merge-base for branch/PR work, an explicit ref when requested, or no-skill when the target is absent at that ref.

Repository source identity is a validity condition. Same-name installed skills are neither an anchor nor valid current execution. Behavior prompts receive an exact snapshot path; host traces that reveal another source fail closed.

### Treat evaluator failures as failed evidence

Mechanical correctness is not semantic validity. A negative substring check for `safe to merge` fails the correct phrase `not safe to merge`. Reading the answer can diagnose that one run, but cannot rehabilitate the check quantitatively.

Record invalidation against the exact attempt, case, and expectation. Block the evidence, replace the suite for every arm, and preserve the prior case across the campaign unless the invalidation supports explicit retirement. This prevents unfavorable cases from disappearing after results are known.

### Keep comparison and confirmation distinct

`compare` runs training calibration. It asks whether current looks better under a frozen initial suite and helps find invalid checks or missing evidence. It does not seal a durable claim.

`confirm` requires a generalization suite, the exact prepared host scope, both training and validation outcome evidence, and the same fixed anchor. It writes a hash-bound evidence claim. It still does not mutate the target.

This replaces promotion-shaped evaluator logic with an evidence boundary. The caller decides whether advice warrants an edit, makes that edit outside Skill Eval, and invokes a new run.

### Persist facts, let an agent reason

Long sessions compact. Conversation summaries are lossy and must not become the evidence source. The engine should build a deterministic index containing source hashes, requested/completed hosts, executions, outcome/mechanism grades, judgments, invalidations, benchmarks, and failures. The index contains no diagnosis or suggested fix.

The agent writes append-only reasoning checkpoints after material passes. A final report is authored by reading the campaign goal, evidence index, checkpoints, and raw artifacts behind surprising claims. This keeps adaptive judgment without pretending generated prose is objective.

### Let the host supervise long commands

The invoking harness owns launch, waiting, cancellation, and completion notification for the outer Bun process. Claude Code uses background Bash and native monitoring. Codex keeps the command attached to a persistent exec session. The engine owns child processes, durable status, artifacts, and resume.

Do not add `nohup`, `setsid`, or an extra `&`. A wrapper can exit while the actual evaluator still runs. A foreground wait ceiling is not a target-skill failure; use model-free status and resume only missing cells.

### Count independent outcomes honestly

One baseline/current execution pair is one independent outcome. Multiple judges on that pair measure adjudication agreement, not sample size. A failed baseline is inconclusive rather than an artificial zero. Timed-out, malformed, source-mutating, and wrong-source cells remain in the ledger but cannot reach qualitative graders or blind judges.

Repetition count is empirical, not ritual. Start with calibration, add runs only when variance or disagreement can change the conclusion, and retain a generous runaway cap solely for unattended safety.

## Why This Matters

This architecture prevents the most damaging false positives:

- green wiring checks reported as user benefit;
- authored-only smoke tests reported as new-skill effectiveness;
- failed baselines manufacturing apparent improvement;
- post-result suite edits erasing regressions;
- installed copies contaminating repository-source tests;
- multiple judge votes inflating independent sample counts;
- evaluator advice being mistaken for measured evidence;
- context compaction replacing artifact-backed reasoning.

It also simplifies ownership. Skill Eval evaluates, diagnoses, and advises. Skill creators and callers author changes. Re-invocation tests whether those changes actually improved the confirmed outcome.

## Example

```text
Hypothesis:
  The current document-review skill finds more material defects without
  materially increasing unsupported findings.

Outcome evidence:
  Blind current/anchor comparison of final reviews on representative plans.

Mechanism evidence:
  Every activated peer completed and its result reached synthesis.

Regression evidence:
  Routine documents do not invoke the peer; normal review still completes.

Calibration:
  One paired run on the invoking host, then the same frozen evidence on the
  second host if valid.

Confirmation:
  Training plus separate validation tasks against the same fixed anchor.

Advice:
  Evidence-linked diagnosis returned to the authoring workflow; no target edit.
```
