---
name: skill-eval
description: Evaluate and diagnose agent skills without installing them. Use when testing new, local, committed, branch, or pull-request skill changes; comparing against a prior or no-skill baseline; checking trigger or behavior regressions; or gathering blind Claude Code and Codex evidence before deciding what to improve.
---

# Skill Eval

Test the actual claim made by one skill change. Usually that claim is improved consumer outcomes over a fixed prior or no-skill baseline; when the requested change is genuinely a narrow trigger, route, format, or other contract, test that contract at its nearest faithful boundary.

- **Result:** an evidence-backed `supported`, `rejected`, or `inconclusive` conclusion with concrete improvement advice.
- **Next consumer:** the skill author or calling workflow that decides what to change next.
- **Done:** the confirmed claim and its material regression or restraint boundaries have run, and more evidence would not change the conclusion or advice.
- **Intent:** scope follows the claim, not the evaluator machinery. Use the smallest realistic evidence set that can resolve the hypothesis across supported runtimes, and stop the target at the earliest boundary that preserves the causal link.

Skill Eval provides cost-bounded triangulation, not exhaustive certification. Decision-sufficient evidence is terminal. Do not run more of the target workflow merely because it is available. Do not edit the target skill, generate challenger versions, select a revision, commit, or promote. The caller or authoring workflow owns changes; after it edits the skill, invoke Skill Eval again against the same campaign goal.

## Required Decisions

1. Infer the target, development baseline, and actual claim from the change.
2. Run preflight before model calls.
3. Map the claim to its changed mechanism, material boundaries, and earliest faithful observation point.
4. Summarize the measurement plan in user terms and wait for confirmation.
5. Prepare immutable baseline/current inputs and independently critique comparative suites.
6. Execute, interpret, and report only the selected evidence.
7. Give evidence-linked advice. Stop without changing the target.

Never weaken the hypothesis after seeing results, reuse an attempt ID, treat mechanism activity as outcome improvement, or let advice become evidence.

Repository source isolation is invariant. Resolve the target first, then inspect and execute only that repository path and frozen snapshots. Ignore same-name skill content already loaded in the invoking session. Never invoke an installed copy of the target skill as either arm.

## Communication Contract

Keep process visibility proportional to its value. Do not narrate every read or command. Batch routine investigation and report only a changed conclusion, a meaningful validity issue, cross-model disagreement or convergence, or a decision the user must make.

Make the subject explicit: evaluator health, measurement design, or target-skill behavior. A critic rejecting a rubric is a measurement-design finding, not a target-skill failure. A foreground wait expiring means the evaluation is still running, not that the target failed. Explain a blocker as cause, effect on the conclusion, and next action.

Before execution, use plain terms such as baseline/current version, test scenario, evidence, and model runs. The user is confirming what will be measured, host coverage, bounded model use, and that Skill Eval will not modify the target. Immutability, attempt IDs, and artifact paths are internal integrity details unless one changes validity. End the proposal with "Start the first pass?"

After each meaningful pass, summarize in at most three compact points: what the evidence changed, important model agreement or disagreement, and what evidence comes next. Do not dump engine machinery.

The final response is an evaluation result, not a workflow recap. Lead with the measured outcome and practical meaning. Use these headings when applicable: **Measured outcome**, **Evidence coverage**, **Cross-model / cross-runtime signal**, **Advice**, and **Not established**. Omit campaign commands, checkpoint IDs, run IDs, and paths unless requested or material. Do not report dollar cost. Report tokens only when requested, budgeted, or themselves under evaluation. State whether another target change is needed; never tell the user to ship, commit, merge, or deploy it.

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

Before selecting cases, build this claim map internally:

- **Claim:** the delivered benefit or exact behavioral contract under test, and its consumer.
- **Mechanism:** what changed and how it can cause that result.
- **Boundaries:** every directly implicated regression, restraint, fallback, or adjacent negative. Treat `only`, `while preserving`, `without`, `except`, and equivalent rationale in the change as candidate boundaries, not commentary.
- **Observation point:** the earliest faithful point where each claim or boundary becomes decidable.

Every material claim and boundary in this map must appear in the campaign goal and map to a suite expectation. Mechanisms receive supporting expectations when needed, but belong in the goal only when the mechanism itself is the contract. Omit unrelated behavior; do not omit an implicated restraint merely because the positive route is easier to observe.

Choose the experiment boundary before building fixtures. When the changed behavior is a decision from state already available to the skill, give a fresh executor that complete state and observe its exact next action; do not construct or run unrelated environment. Simulate state acquisition or side effects only when they are part of the claim, and run through the delivered output only when that downstream result is the claim. Supplying state directly is invalid when it bypasses the changed mechanism.

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

Use the observation points from the claim map independently. A restraint must not widen the execution boundary of the positive claim; test each through the earliest point that makes it decidable. Routing conformance has a two-case coverage floor: one realistic positive and one nearest-negative exclusion. Frozen source may establish prior baseline behavior, but it does not replace a current-runtime restraint case.

Read `references/evidence-preparation.md` before creating a routing campaign and pass its boundary-stop gate. A tool-call expectation observes dispatch but does not stop the called component or later workflow. Full execution is valid only when the changed mechanism's downstream effect is itself part of the claim or a concrete feasibility check shows that earlier interception would invalidate it. Inspectable contracts use deterministic checks. Output-quality claims require paired outputs and blind judgment. Broad consumer claims need realistic downstream tasks. Do not stub the component claimed to create the benefit.

Assume skills target both Claude Code and Codex. When both hosts are ready, recommend both. Run mechanically prevalidated, independent, low-risk host coverage in parallel when one host cannot change the other's suite; otherwise calibrate on the invoking host first, then automatically run the same frozen evidence on the second host. A one-host sanity check is acceptable only when explicitly requested, genuinely host-specific, fully deterministic, or forced by unavailable coverage or a hard user budget; state that it does not establish cross-host behavior.

For conformance, default to the current version only. Add an anchor execution only when prior runtime behavior is uncertain and observing it could change the contract conclusion. Scope changed-only mechanism expectations to `candidate` and any baseline-only mechanism expectations to `anchor`; expected baseline behavior must not appear as a target failure.

Design the smallest **sufficient** suite before execution. A broad effectiveness claim normally needs distinct realistic improvement situations plus the material regression, restraint, fallback, or adjacent-negative boundaries implicated by the change. One favorable case cannot establish that breadth; one case is enough only for a genuinely narrow deterministic contract. Do not confuse scenario breadth with repetition count.

Start with one repetition per case when it can calibrate feasibility and variance. Before adding evidence beyond the confirmed suite, name the unresolved uncertainty and how each plausible result would change the verdict or advice. If neither result would change the decision, stop. Add repetitions only when observed variance, disagreement, or host differences could reverse the conclusion. Model-call and elapsed-time ceilings are runaway safety pauses, not evidence thresholds.

The suite hypothesis states the terminal improvement plus material regression and restraint boundaries. It contains behavior only: do not add host names, version labels, run counts, judge allocation, budgets, or words such as `verified` that imply evidence already exists. Before creating the campaign, map every material outcome, regression, and restraint clause to at least one suite expectation. Do not name a boundary in the goal or proposal and leave it unmeasured.

If one measurement goal clearly follows from the request and runtime dataflow, infer it. If two or more materially different goals remain plausible, use the harness's native blocking question to offer at most three concise choices before creating a campaign. Recommend the terminal effectiveness question when the changed mechanism exists to improve a consumed output; offer mechanism-only conformance as a narrower alternative, not an equivalent substitute. State what each choice establishes, what it leaves untested, and its relative execution or external-call burden. Include a stop option only when existing evidence may already answer the user's need. Do not ask the user to choose fixtures, graders, repetition counts, or other methodology the evaluator can determine.

Create the campaign before asking for confirmation. Campaign goals are immutable; if the user later changes the claimed outcome or a material boundary, create a new campaign instead of carrying the old boundary as an untested limitation.

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" campaign-init --target "<target-skill>" --goal "<exact behavioral contract>"
```

Draft the suite in OS temp and get exact direct-call counts with `estimate`. Use workflow `run` for conformance, normally with only `authored`; use `compare` with `anchor,authored` for effectiveness or generalization. Pass judge hosts for any qualitative expectations. Do not invent token or wall-clock estimates; nested target work remains unknown until calibration.

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" estimate --suite "<draft-suite-json>" --workflow "<run|compare>" --versions "<anchor,authored-or-authored>" --hosts "<calibration-hosts>" [--judge-hosts "<judge-hosts>"] [--critic-hosts "<critic-hosts>"] --repetitions 1 --partition training
```

Do not ask for confirmation until `estimate` succeeds and the proposal states its exact direct-call count. Nested calls made by the target remain a separate unknown.

In under 180 words, present: the exact measurement goal, how scenarios test improvement, regression/trigger coverage, the execution boundary and whether downstream work is intercepted or runs, recommended hosts and calibration sequence, direct call count, stopping condition, and what remains unknown. Never predict an outcome from home-directory, network, installed-tool, or other external state the fixture does not control. State plainly that this run evaluates and advises but will not edit. Wait for confirmation.

## 3. Prepare And Critique Evidence

After confirmation, read `references/schemas.md`, then read `references/evidence-preparation.md` if it was not already loaded for routing. Copy the confirmed campaign `measurement_goal` exactly into the suite `hypothesis`. Use `evidence_role` on every expectation. Generalization requires outcome evidence in both training and caller-visible validation partitions.

Before any replacement run, decide whether the adjustment repairs measurement or changes the claim. Reuse the campaign only for fixture, check, or observability repairs that preserve the exact outcome and material boundaries. A user correction that narrows or broadens those boundaries supersedes the campaign: create a new one and reconfirm unless the user explicitly confirmed the exact revised scope.

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

For effectiveness or generalization paired training calibration:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" compare --run-dir "<run-dir>" --left anchor --right authored --label calibration --hosts "<calibration-host>" --judge-hosts "<ready-evaluator-hosts>" --repetitions 1 [--executor-timeout-ms "<validated-ceiling>"]
```

For conformance, estimate with workflow `run`, execute with `run`, and use `grade`; `compare` rejects conformance. Prefer authored-only, version-scoped deterministic checks. Use `trigger --partition training|validation|all` for discovery-only evaluation, `grade-model` only for unavoidable single-output qualitative expectations, and `judge` for paired comparison expectations. Never use a judge to bypass missing, timed-out, malformed, source-mutating, or wrong-source executions.

Cross-model calls default to `claude-opus-4-8` at high effort and `gpt-5.6-sol` at high reasoning. These are evaluator-ceiling defaults, not proof of weaker-runtime portability. Role-specific behavior and evaluator overrides may be supplied when the user asks to test a floor runtime. Do not invent model IDs. These settings do not override nested models chosen by the target skill.

Long commands must use the invoking harness's native background or persistent-command primitive from the outset. Read `references/hosts.md`. Use model-free status rather than manual polling:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" status --run-dir "<run-dir>" --wait --timeout-ms "<foreground-or-operation-ceiling>"
```

A timeout is inconclusive, not a regression. Raise a ceiling only from a known nested cap or observed calibration, then resume the same labeled workflow.

If a deterministic check is semantically wrong after raw inspection, run `invalidate-check`. The result becomes blocked, not passed. Replace the check for every arm in a new prepared run. Campaign case retirement additionally requires this hash-bound invalidation evidence.

After valid invoking-host calibration, complete already-confirmed second-host coverage. If the prevalidated host runs were independent and launched together, adjudicate them together. Add repetitions only if uncertainty could change the verdict. Stop when the hypothesis is supported, rejected, or genuinely inconclusive at the confirmed scope. An unfavorable target result is evidence, not a reason to redesign the suite or add rounds until the hypothesis passes. Ask before any material expansion beyond the confirmed plan, giving the unresolved question and incremental direct-call count.

## 5. Confirm And Build The Evidence Record

Use `confirm` only when the confirmed measurement goal claims generalization. Do not escalate an effectiveness evaluation into confirmation merely because stronger confidence is possible. Confirmation reruns authored versus the same fixed anchor across training and validation, requires the exact prepared host scope, and seals a hash-bound evidence claim. It never changes the target. Its default is one repetition; increase it only under the decision-change rule above.

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" confirm --run-dir "<run-dir>" --label confirmation --hosts "<prepared-hosts>" --judge-hosts "<ready-evaluator-hosts>"
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

Do not infer that work was cheap, fast, safe, or ready to ship from successful completion or a skipped escalation. Such claims require direct supporting measurements within the confirmed scope. Describe fixture isolation and unfrozen external state separately.

State cross-model value only when it changed the conclusion: material agreement, disputed cases, or disagreement that became convergence. If model, harness, effort, tools, or context changed together, call it a cross-runtime signal rather than attributing causality to the model alone. Coverage by two hosts is not itself cross-model value.

Advice must map each material failure or uncertainty to observed evidence, the likely owning skill layer, and the smallest change class that could address it. Advice may recommend a focused prose edit, fixture-independent contract change, reference restructuring, script change, or broader skill restructure. Do not prescribe more prose by default. Clearly distinguish demonstrated defects, plausible diagnoses, and optional authoring best practices. Include only limitations that bound the confirmed claim; do not carry superseded or unrelated capabilities into **Not established**. State whether the target needs another change, but do not recommend committing, shipping, or merging it.

Do not apply the advice. Return control to the caller. A caller that edits the skill should rerun Skill Eval with the same confirmed campaign goal and fixed anchor so the new evidence tests whether the proposed improvement actually worked without erasing prior regressions.
