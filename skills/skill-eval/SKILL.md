---
name: skill-eval
description: Evaluate and diagnose agent skills without installing them. Use when testing new, local, committed, branch, or pull-request skill changes; comparing against a prior or no-skill baseline; checking trigger or behavior regressions; or gathering blind Claude Code and Codex evidence before deciding what to improve.
---

# Skill Eval

Evaluate one primary skill against a fixed development baseline. Produce reproducible evidence, a calibrated conclusion, and concrete improvement advice. Do not edit the target skill, generate challenger versions, select a revision, commit, or promote. The caller or authoring workflow owns changes; after it edits the skill, invoke Skill Eval again against the same campaign goal.

Skill Eval provides cost-bounded triangulation, not exhaustive certification. Add evidence only when it can materially change confidence in the confirmed hypothesis.

## Required Decisions

1. Infer the target, development baseline, and intended consumer benefit from the actual change.
2. Run preflight before model calls.
3. Select the smallest evidence scope that can test the benefit and material regressions.
4. Summarize the measurement plan in user terms and wait for confirmation.
5. Prepare immutable baseline/current inputs and independently critique the suite.
6. Execute, interpret, and report only the selected evidence.
7. Give evidence-linked advice. Stop without changing the target.

Do not run the full workflow by default. Never weaken the hypothesis after seeing results, reuse an attempt ID, treat mechanism activity as outcome improvement, or let advice become evidence.

Repository source isolation is invariant. Resolve the target first, then inspect and execute only that repository path and frozen snapshots. Ignore same-name skill content already loaded in the invoking session. Never invoke an installed copy of the target skill as either arm.

## Communication Contract

Keep process visibility proportional to its value. Do not narrate every read or command. Batch routine investigation and report only a changed conclusion, a meaningful validity issue, cross-model disagreement or convergence, or a decision the user must make.

Make the subject explicit: evaluator health, measurement design, or target-skill behavior. A critic rejecting a rubric is a measurement-design finding, not a target-skill failure. A foreground wait expiring means the evaluation is still running, not that the target failed. Explain a blocker as cause, effect on the conclusion, and next action.

Before execution, use plain terms such as baseline/current version, test scenario, evidence, and model runs. The user is confirming what will be measured, host coverage, bounded model use, and that Skill Eval will not modify the target. Immutability, attempt IDs, and artifact paths are internal integrity details unless one changes validity. End the proposal with "Start the first pass?"

After each meaningful pass, summarize in at most three compact points: what the evidence changed, important model agreement or disagreement, and what evidence comes next. Do not dump engine machinery.

The final response is an evaluation result, not a workflow recap. Lead with the measured outcome and practical meaning. Use these headings when applicable: **Measured outcome**, **Evidence coverage**, **Cross-model / cross-runtime signal**, **Advice**, and **Not established**. Omit campaign commands, checkpoint IDs, run IDs, and paths unless requested or material. Do not report dollar cost. Report tokens only when requested, budgeted, or themselves under evaluation.

Reserve "end-to-end" for evidence that reaches the terminal consumer outcome. Do not call the whole skill effective when the primary outcome was blocked, degraded, or outside the suite.

## 1. Resolve Target And Baseline

Infer one primary skill from an explicit path/name, PR, the only changed `SKILL.md`, or an otherwise unambiguous nearby skill. A bare name resolves against conventional repository skill directories and exact frontmatter names. Ask one short question only if multiple targets remain.

Choose the anchor from the development state:

- Local edits relative to the latest commit: `HEAD`.
- Branch or PR work: the merge base of branch head and the actual base ref.
- Explicit comparison: the requested commit.
- New skill absent at the selected ref: no-skill baseline.

The current arm is the target directory exactly as it exists now, including committed and uncommitted work. This supports brand-new skills, fully pushed branches, and anything between. If anchor and current hashes match, stop before model calls because no comparison delta exists.

Run preflight:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" preflight --target "<target-skill>" --invoking-host "<claude-or-codex>" --hosts "claude,codex"
```

Block on a missing invoking host, Bun 1.2+, Git, target, repository, or temporary storage. Ask before installing dependencies or starting authentication. A missing secondary host degrades coverage but does not block best-effort evaluation. Read `references/hosts.md` for host discovery, model defaults, or long-running job supervision.

If preflight identifies possible evaluator-only files, inspect them. Exclude only answer keys or authoring eval specifications that the runtime skill does not consume. Never exclude a runtime reference merely because its name contains `eval`.

## 2. Define The Hypothesis

Inspect the complete anchor-to-current diff, current skill, directly affected callers and consumers, tests, and output contracts. Reconcile the implementation with the user's request. PR descriptions, plans, comments, and old eval specs are supporting context, not scope authority.

Read `references/eval-design.md` now.

Trace each changed mechanism through immediate effects to the terminal consumer benefit. Complete internally:

> The change exists so `<consumer>` gets `<terminal benefit>`; the improvement case fails when `<benefit is absent even though the mechanism works>`.

Do not stop at the first observable effect. Presence, provenance, routing, a tool launch, fold-in, or formatting is mechanism evidence unless that effect is itself the requested outcome. Stochastic or subjective outcomes remain testable through anonymous paired comparison.

Classify every expectation as:

- `outcome`: evidence that directly supports or refutes the user-facing hypothesis.
- `mechanism`: evidence that explains the causal path or blocks success when a required component fails.

Mechanism evidence can fail a critical gate. It cannot create an objective pass-rate gain, qualitative preference, or effectiveness verdict.

Assign one claim class:

- `conformance`: the skill follows a specified trigger, route, format, or contract.
- `effectiveness`: the current skill improves a user outcome over the fixed anchor.
- `generalization`: the improvement also survives separate validation situations and material regressions.

A new skill must earn its keep against normal no-skill behavior for effectiveness or generalization. Authored-only evidence can establish conformance, never improvement.

### Scope And Host Coverage

Use the narrowest execution boundary that preserves the causal link. Trigger-only questions need realistic positive and adjacent-negative trigger probes, not full skill runs. Inspectable contracts may use deterministic checks. Output-quality claims require paired outputs and blind judgment. Broad consumer claims need realistic downstream tasks. Do not stub the component claimed to create the benefit.

Assume skills target both Claude Code and Codex. When both hosts are ready, recommend both and calibrate on the invoking host first. After valid calibration, automatically run the same frozen evidence on the second host within the confirmed scope. A one-host sanity check is acceptable only when explicitly requested, genuinely host-specific, fully deterministic, or forced by unavailable coverage or a hard user budget; state that it does not establish cross-host behavior.

Start with one repetition when it can calibrate the claim. Add repetitions only when observed variance, disagreement, or host differences could reverse the conclusion. Model-call and elapsed-time ceilings are runaway safety pauses, not evidence thresholds.

The suite hypothesis states the terminal improvement plus material regression and restraint boundaries. It must not contain repetition counts, judge counts, or budgets unless the user made them part of the requested behavior.

Create the campaign before asking for confirmation:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" campaign-init --target "<target-skill>" --goal "<exact behavioral contract>"
```

Draft the suite in OS temp and get exact direct-call counts with `estimate`. Do not invent token or wall-clock estimates; nested target work remains unknown until calibration.

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" estimate --suite "<draft-suite-json>" --workflow "<run|compare>" --versions "<anchor,authored-or-authored>" --hosts "<calibration-hosts>" [--judge-hosts "<judge-hosts>"] [--critic-hosts "<critic-hosts>"] --repetitions 1 --partition training
```

In under 180 words, present: the exact measurement goal, how scenarios test improvement, regression/trigger coverage, recommended hosts and calibration sequence, direct call count, and what remains unknown. State plainly that this run evaluates and advises but will not edit. Wait for confirmation.

## 3. Prepare And Critique Evidence

After confirmation, read `references/schemas.md`, then `references/evidence-preparation.md`. Copy the confirmed campaign `measurement_goal` exactly into the suite `hypothesis`. Use `evidence_role` on every expectation. Generalization requires outcome evidence in both training and caller-visible validation partitions.

Keep prior campaign case and trigger IDs unless hash-bound invalidation evidence justifies retirement. Do not remove a failing case because it makes the result worse. Validation cases may be visible to the caller and evaluator, but must remain distinct from calibration evidence; never describe them as secret or untouched.

Prepare immutable inputs:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" prepare --target "<target-skill>" --suite "<suite-json>" --invoking-host "<claude-or-codex>" --hosts "<ready-hosts>" --campaign "<campaign-dir>" --role "<calibration|confirmation|other>" [--anchor-ref "<resolved-anchor>"] [--exclude-from-executor "<evaluator-only-paths>"]
```

Effectiveness and generalization require an independent suite critique before model execution:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" critique-suite --run-dir "<run-dir>" --critic-hosts "<ready-hosts>"
```

Critics test whether scenarios can answer the confirmed hypothesis, whether the baseline discriminates, whether outcome evidence reaches the consumer benefit, and whether treatment-identifying evidence is symmetrically projected. Critics advise; the campaign goal remains scope authority. Adjudicate every issue once. A critical issue cannot be waived as a limitation, and an accepted issue requires a replacement prepared run. Do not rerun critics merely to search for approval.

Write one adjudication JSON object using the schema in `references/schemas.md`, then record every critic issue exactly once:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" adjudicate-suite --run-dir "<run-dir>" --input "<adjudication-json>"
```

## 4. Execute The Smallest Resolving Test

For a paired training calibration:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" compare --run-dir "<run-dir>" --left anchor --right authored --label calibration --hosts "<calibration-host>" --judge-hosts "<ready-evaluator-hosts>" --repetitions 1 [--executor-timeout-ms "<validated-ceiling>"]
```

Use `trigger --partition training|validation|all` for discovery-only evaluation. Use `check-script`, `run`, and `grade` for deterministic conformance. Use `grade-model` only for single-output qualitative expectations and `judge` for paired comparison expectations. Never use a judge to bypass missing, timed-out, malformed, source-mutating, or wrong-source executions.

Cross-model calls default to `claude-opus-4-8` at high effort and `gpt-5.6-sol` at high reasoning. These are evaluator-ceiling defaults, not proof of weaker-runtime portability. Role-specific behavior and evaluator overrides may be supplied when the user asks to test a floor runtime. Do not invent model IDs. These settings do not override nested models chosen by the target skill.

Long commands must use the invoking harness's native background or persistent-command primitive from the outset. Read `references/hosts.md`. Use model-free status rather than manual polling:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" status --run-dir "<run-dir>" --wait --timeout-ms "<foreground-or-operation-ceiling>"
```

A timeout is inconclusive, not a regression. Raise a ceiling only from a known nested cap or observed calibration, then resume the same labeled workflow.

If a deterministic check is semantically wrong after raw inspection, run `invalidate-check`. The result becomes blocked, not passed. Replace the check for every arm in a new prepared run. Campaign case retirement additionally requires this hash-bound invalidation evidence.

After valid invoking-host calibration, complete already-confirmed second-host coverage. Add repetitions only if uncertainty could change the verdict. Stop when the hypothesis is supported, rejected, or genuinely inconclusive at the confirmed scope.

## 5. Confirm And Build The Evidence Record

Use `confirm` only when the claim warrants generalization. It reruns authored versus the same fixed anchor across training and validation, requires the exact prepared host scope, and seals a hash-bound evidence claim. It never changes the target.

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" confirm --run-dir "<run-dir>" --label confirmation --hosts "<prepared-hosts>" --judge-hosts "<ready-evaluator-hosts>" --repetitions 3
```

Build the factual evidence index after material passes and before reporting:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" evidence-index --run-dir "<run-dir>"
```

Write an agent-authored campaign checkpoint after a material pass, correction, or feasibility change. The engine indexes facts; the agent reasons over them. Checkpoints preserve interpretation across context compaction but do not become objective evidence.

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" campaign-checkpoint --campaign "<campaign-dir>" --input "<checkpoint-json>"
```

On resume, find the exact-target campaign with `campaign-list`, then read `campaign-context`. Re-open raw artifacts behind any material or surprising claim. Never reconstruct a final verdict from conversation history alone.

## 6. Resolve Genuine Human Disputes

Use a review page only when anonymous evaluators genuinely disagree on a subjective decision or the user asks. Read `references/human-review.md`. The page is display-only; ask the decision through the active harness's native blocking question and record it with `record-feedback`. Human judgment adjudicates only the anonymous comparison and cannot waive objective gates.

## 7. Report And Return Advice

Reconcile completed versus failed/timed-out executions, valid versus invalid qualitative grades, valid blind judgments, and required-host coverage. Record count is not success count. A qualitative expectation with `passed: null` awaits model grading. Do not claim a blind comparison when no valid judgment exists or cross-host behavior when a required host failed.

Quantify only artifact-supported measurements relevant to the hypothesis: outcome pass rates, critical mechanism gates, blind pair preferences, standard deviation/stability, trigger precision/recall/false-trigger rate, duration, errors, and skill-byte delta. Multiple judges on one execution pair are one independent outcome, not extra samples.

State cross-model value only when it changed the conclusion: material agreement, disputed cases, or disagreement that became convergence. If model, harness, effort, tools, or context changed together, call it a cross-runtime signal rather than attributing causality to the model alone. Coverage by two hosts is not itself cross-model value.

Advice must map each material failure or uncertainty to observed evidence, the likely owning skill layer, and the smallest change class that could address it. Advice may recommend a focused prose edit, fixture-independent contract change, reference restructuring, script change, or broader skill restructure. Do not prescribe more prose by default. Clearly distinguish demonstrated defects, plausible diagnoses, and optional authoring best practices.

Do not apply the advice. Return control to the caller. A caller that edits the skill should rerun Skill Eval with the same confirmed campaign goal and fixed anchor so the new evidence tests whether the proposed improvement actually worked without erasing prior regressions.
