# Eval Design And Calibration

Read this reference before proposing the confirmation summary or authoring a suite.

## Cost-Bounded Evidence Escalation

Start with the weakest evidentiary layer that can resolve the confirmed claim, then add a perspective only while material uncertainty remains:

1. Mechanical contracts and deterministic boundary checks.
2. A small behavior-floor probe when the claim is instruction-sensitive and a ceiling model may silently repair weak prose.
3. Cross-runtime ceiling perspectives for quality, judgment, or generalization.
4. A fresh downstream consumer when the claimed benefit is realized by that consumer and artifact inspection is insufficient.
5. Repeat only for materially high-variance judgment such as synthesis or ideation.

This is an escalation order, not a mandatory matrix. Scope a behavior-floor probe to the smallest improvement and restraint cases that could change the conclusion. A ceiling tie establishes no regression, not portable improvement. When no floor ran, report that weaker-model portability was not established.

Infer a realistic behavior floor from the skill's intended users, active project constraints, and models actually available in the harness, then include that profile in the confirmation plan. Do not invent or permanently encode a universal floor model. If no defensible floor is available, omit the probe and state the limitation.

Keep behavior and evaluator runtime roles distinct. Record the effective harness, model, effort, context mode, and capability scope. When several dimensions changed together, describe disagreement or convergence as a **cross-runtime signal**; reserve causal cross-model or cross-harness language for a design that isolated that dimension.

## Match Evidence To The Question

Classify the conclusion before writing cases:

- `conformance`: whether a trigger, gate, route, format, fallback, or other contract is obeyed. Authored-only evidence is allowed, but the result is contract validation, never effectiveness or improvement.
- `effectiveness`: whether the skill improves the user's outcome. A paired anchor is mandatory. A new skill uses normal no-skill behavior as its baseline; an existing skill uses the selected prior snapshot.
- `generalization`: whether a demonstrated improvement remains stable across separate validation situations and material regressions. It includes the effectiveness baseline, both hosts when available, and outcome evidence in both partitions.

Most planning, writing, review, synthesis, and decision-making changes are effectiveness claims even when their implementation is a gate or orchestration step. Use conformance only when the user's question is genuinely limited to the contract.

Conformance establishes whether the current skill obeys that contract. Default to the authored/current version; source and frozen-diff evidence may establish the old rule without spending a baseline model call. Execute the anchor only when its runtime behavior is itself uncertain and could change the conclusion. Scope changed-only mechanism expectations to `candidate` and baseline-only mechanism expectations to `anchor` so expected differences do not become failed grades; outcome expectations remain version-neutral.

Start from what the user asked to learn or improve. A trigger question needs trigger queries, not a full skill execution. An inspectable routing or artifact claim should use focused cases and objective checks. A quality claim needs representative outputs and anonymous comparison. These modes compose when one change has both kinds of claim. Reserve a full end-to-end suite for changes whose effects cross the workflow or for conclusions explicitly scoped to the whole skill.

Do not hide a material claim choice inside one proposed suite. When the request could reasonably mean either terminal effectiveness or mechanism conformance, explain the tradeoff and let the user choose before fixing the campaign goal. Recommend effectiveness when the mechanism was introduced to improve a consumed output. A conformance option must say plainly that it can prove the wiring or contract but not the benefit. This is a scope decision; the evaluator still owns fixtures, checks, judge allocation, and repetitions.

Fixture fidelity must preserve constitutive context. Project instructions, installed capabilities, organization policy, external state, or mutation authority are not optional realism when the target skill depends on them. Reproduce that context or narrow the conclusion explicitly.

When a document, plan, review, research artifact, or decision exists to support a later agent, test downstream usability with a fresh executor that receives only the artifact and a realistic consumer task. Do this only when downstream use is the confirmed benefit and inspection cannot establish it; do not add a second stage by habit.

Evaluate activation separately from execution. Positive queries, adjacent negatives, and explicit invocation belong to trigger or description conformance. Behavior prompts remain ordinary user tasks and must not name-invoke the target skill, because doing so can collapse the frozen baseline and candidate onto an installed copy.

User constraints on cases, hosts, repetitions, comparison refs, or budget are part of the contract. Follow them unless they make the requested conclusion unsupported; in that case explain the narrower claim before execution.

## Choose The Right-Sized Experiment

Select the least constructed experiment that still crosses the changed causal boundary:

1. **Direct decision probe:** when the skill receives relevant state and the claim is how it interprets that state, give a fresh executor a complete realistic snapshot and ask for its exact next action, command, artifact, or user-facing report. Prohibit unrelated tool use and stop at that decision.
2. **Simulated environment:** when discovering state, choosing a tool, or producing a side effect is part of the claim, provide only the synthetic repository, fake CLI, service, or files needed to make that behavior observable.
3. **Stage or workflow execution:** when the claim is the quality or usefulness of a downstream result, execute through the stage that produces the result. Run the full workflow only when earlier entry would remove constitutive context or the terminal workflow outcome is itself under test.

A direct decision probe is not a shortcut around the treatment. Use it only when upstream acquisition is unchanged or outside the confirmed claim; supplying a value that the changed skill must discover, validate, or transform would bypass the mechanism and invalidate the result. Give the executor situation facts, not the expected answer or grading criteria.

For a comparative claim, use the same state snapshot and task for anchor and current. The discriminating probe should make the old shortcut plausible rather than quote either version's rule. Nearby current-only decision probes may establish restraints or safety invariants, but they do not count as improvement evidence.

Persist the exact behavioral contract before asking for confirmation, and show the same text to the user without paraphrase. The campaign goal must already contain the terminal improvement and named regression/restraint boundaries when the user approves it. Do not create or strengthen that authority after confirmation.

Treat PR descriptions, plans, comments, docs, tests, authored eval specs, and prior campaign checkpoints as candidate evidence, not scope authority. They may be stale, incomplete, or focused on one layer. On resume, the campaign measurement goal plus explicit constraints still visible in the conversation define the confirmed boundary; a prior suite does not authenticate its own hypothesis. Reconcile other sources with the complete anchor-to-authored implementation and runtime dataflow. Compare existing tests and evals with the independently derived claim map: reuse valid cases, add missing claim layers, and reject expectations contradicted by current behavior. Their silence does not prove that an outcome is out of scope. When sources conflict, state the inferred claim and uncertainty in the confirmation summary instead of silently choosing the easiest artifact to test.

## Trace Mechanism To Outcome

Do not build a prompt list from the visible symptom alone. For a revision, inspect the complete selected-anchor-to-authored diff and identify what mechanism changed: routing, a gate, completion criteria, reference loading, output format, tool selection, portability, side effects, or validation. Then trace each mechanism through callers and handoffs to the output a user or downstream consumer actually receives.

Map:

- the intended delivered outcome and who consumes it;
- the enabling mechanisms and direct effects;
- every branch affected by the mechanism;
- shortcuts or rationalizations the old version may take;
- callers, sibling routes, and handoffs;
- emitted files, schemas, menus, and side effects;
- behavior outside the change that must remain stable.

For a new skill, derive the same map from the user's task, runtime contract, and likely no-skill behavior.

When a mechanism exists to alter the quality or usefulness of a consumed output, make that delivered outcome the primary claim. Treat mechanism engagement as necessary supporting evidence and neighboring stability as regression evidence. A gate firing, command launching, artifact appearing, or result folding in can all succeed while the intended output remains unimproved; such evidence cannot establish the delivered outcome.

Apply the counterfactual test: could the proposed suite pass when the mechanism runs exactly as designed but the claimed terminal user benefit never appears? If yes, the outcome layer is missing. A mechanism-only case can support an improvement claim but cannot be the sole improvement evidence.

Pressure example: a second model is added to improve review quality. A peer call, folded finding, and promoted label prove the causal path, not the quality gain. The outcome case must use the real peer and blindly compare the final reviews for material issue coverage and noise; otherwise every mechanism check can pass while review quality stays flat.

## Build A Branch Matrix

Consider only branches relevant to the mechanism:

- default and explicit opt-in;
- skip or default-closed;
- unavailable, unsupported, and exception paths;
- user-says-only or constrained modes;
- ambiguous inputs;
- format and output modes;
- downstream consumer or router behavior.

Create the smallest sufficient set where each case proves one material boundary. One favorable finding or scenario cannot establish a broader effectiveness claim: include enough distinct realistic situations to cover the terminal improvement and every material regression, restraint, fallback, or adjacent-negative boundary implicated by the change. More paraphrases of the same branch are not broader coverage. Minimize redundant proofs within the mechanism, outcome, and regression layers; do not remove a required layer merely because another is cheaper to inspect.

Routing conformance requires both sides of the decision: at least one positive dispatch case and the nearest current-runtime exclusion case. Reading the frozen source may establish what the prior version specified, but it cannot prove that the current model honors the exclusion. Give the two cases separate stop points when their observable boundaries differ.

Assign each case one purpose:

- `improvement`: distinguishes the intended gain from the anchor;
- `regression`: protects behavior outside the change;
- `restraint`: proves the new rule does not fire;
- `fallback`: exercises unavailable or exception behavior;
- `trigger`: tests discovery separately from execution.

Assign `critical`, `quality`, or `diagnostic` severity. A critical failure blocks the claimed conclusion.

Assign every expectation `evidence_role: "outcome" | "mechanism"`. Outcome evidence directly supports the terminal hypothesis and is the only evidence eligible for pass-rate gains, qualitative preference, or an effectiveness verdict. Mechanism evidence can explain causality and a critical mechanism failure can block success, but a passing mechanism cannot create an improvement.

A tool invocation or result is normally mechanism evidence. It may be an outcome only when that tool action is itself the terminal user result, such as posting the requested message or changing the requested external record. In an effectiveness or generalization suite, declare that exceptional case with `outcome_basis: "terminal-action"`. A peer call, router dispatch, file read, or internal orchestration step never qualifies merely because it uses a tool.

Qualitative expectations also have an evidence scope. Omit `scope` or use `scope: "execution"` only when one anonymous output can establish the claim by itself. Use `scope: "comparison"` for relative claims such as better coverage, lower fabrication, or no regression; only a blind judge with both outputs can decide them. Set `comparison_goal` to `improve` when the candidate must win or `not-worse` when a tie passes. A critical comparison expectation gates the benchmark independently of the overall preference. Split mixed claims so a single-output grader cannot infer the unseen baseline. Deterministic checks cannot use comparison scope.

When a mechanism exists only in the changed skill, do not describe an authored-only exception in prose. Set `version_scope: "candidate"`. If that mechanism must work before its outcome can be judged, make its objective check a critical mechanism `prerequisite`; prerequisites gate applicable executions but do not enter pass-rate arithmetic. Keep the delivered benefit as a separate outcome, usually comparison-scoped.

## Prefer Inspectable Evidence

Prefer files, schemas, command traces, loaded references, routing decisions, omitted prompts, and observable side effects. Use deterministic checks for objective facts. Use `tool_called`, `tool_not_called`, or `tool_call_count` when the claim is whether orchestration launched a command or tool. Use `tool_result_contains` when the command must also return a specific success signal; invocation text cannot prove a usable result. Reserve natural-language expectations for qualitative judgment.

For fixture-repository state, select the workspace assertion root explicitly. For structured returns and fake-service ledgers, assert exact JSON fields rather than requiring a status token in final prose. A correct answer may quote a forbidden phrase to reject it or paraphrase a required semantic status; substring checks cannot distinguish either case.

The executor's claim that it succeeded is not evidence. A filename alone is weak evidence when content can be inspected.

Objective mechanism evidence and qualitative outcome evidence are complementary. If the claimed benefit is produced by an external model, tool, reference, or downstream stage, a fake can validate routing and failure handling but cannot prove the benefit. Do not stub the component claimed to create the benefit in the outcome case.

If that outcome-producing dependency is unavailable, mark that outcome blocked or degraded. Do not silently replace it with a stub, narrow the suite to mechanism checks, and still report an improvement evaluation.

Do not replace a stochastic or subjective quality outcome with a deterministic proxy merely because the proxy is cheaper. Use objective checks to prove the causal path and anonymous repeated comparison to judge the quality claim. A paired criterion must be explicitly comparison-scoped; mentioning the baseline inside an execution-scoped expectation does not give its grader baseline evidence.

Do not require byte equality between independent model runs unless the output is deterministic by contract. For stochastic outputs, protect objective invariants mechanically and judge quality or non-regression through anonymous comparison across repetitions.

## Design Real Fixtures

The fixture should resemble the environment the skill serves, not necessarily the repository where the skill is authored. Use a synthetic repository, Git history, fake CLI, local service, project conventions, input files, or no fixture. Place executable fake commands under the fixture's `bin/` directory; it is prepended to the executor task's `PATH`. Freeze opaque bytes and copy them fresh for every arm.

Use the narrowest execution boundary that preserves the causal link to the claim. A trigger or routing claim may stop before full execution. An outcome claim may bypass unrelated setup and exercise the changed stage directly, but it must still produce the artifact or behavior the real consumer receives. Design at least one representative fixture where the claimed delta could appear; if both arms are structurally unable to diverge, the fixture cannot calibrate improvement.

At a routing boundary, prove dispatch with a structured tool event or sentinel side effect, then stop. Stub or fast-return the next unchanged component when it is not the claimed outcome; do not tell the executor to perform that component merely to prove it was selected. Verify the actual fixture enforces the stop: an expectation that observes a tool call does not stop the called tool or later workflow by itself. If the component reads mutable user state, either intercept it before consumption or disclose the state actually consumed without predicting its contents.

Never include the suite, expected answers, comparison labels, or validation cases in a training executor workspace.

Do not put a same-name `Skill(...)`, slash-command, or installed-entrypoint invocation in an eval prompt. The executor already supplies the frozen target snapshot by exact path; a name-based invocation risks loading a cached installation and invalidating the counterfactual.

Declare fixture fidelity in the suite as `isolated`, `project-context`, or `live`, plus every external state dependency the run cannot freeze. Isolation improves repeatability but omits installed plugins, user rules, MCP servers, and ambient project state. Use project-context or live evidence when that context is part of the claimed benefit, and disclose mutable dependencies rather than implying they were controlled.

## Calibrate Then Freeze

Run anchor and authored candidate on the same fixture before revision whenever the claim is comparative. An authored-only run can prove operability, not improvement. Remove cases where both versions pass for the same shortcut, both fail because the fixture is broken, or multiple prompts prove the same boundary. Strengthen expectations that can pass superficially.

One repetition may calibrate feasibility and direct-call expansion. Do not treat it as sufficient evidence for a stochastic quality claim; use observed variance and disagreement to choose further repetitions before reporting the outcome as established.

Treat each baseline/candidate execution pair as one independent outcome. Multiple blind judges on that same pair measure adjudication agreement, not additional samples. Do not preselect a universal repetition count: calibrate, inspect pair-level disagreement and variance, then add only the runs whose outcomes could change the decision. Keep an explicit model-call or elapsed-time ceiling solely as a safety pause.

The hypothesis describes the expected behavioral difference, not how many runs will be used to assess it. Keep repetition counts, judge allocation, aggregation thresholds, and budgets in the measurement plan. Preserve an explicit user constraint, but do not promote a critic's proposed protocol into the hypothesis; doing so makes advisory methodology appear to be the outcome under test and can force unnecessary execution after calibration already resolves the claim.

Avoid post-treatment selection. A prerequisite may exclude a run where the candidate mechanism was unavailable, timed out, malformed, or otherwise could not receive the treatment. It must not exclude a valid treatment result because it was empty, weak, or unfavorable. Those outcomes are part of the effectiveness measurement. For example, a valid peer response with zero findings is evidence of no added finding on that run, not an environment failure.

For a treatment with a deterministically activated finite component set, prove that every activated component ran and returned a valid result. When activation is model-judged, compare downstream dispatch and collection with the observed activated set; do not turn nominal eligibility into an exact-count prerequisite. A missing expected activation remains a scored behavior result. Do not require at least one treatment return as a prerequisite when zero activations are possible, because that excludes the no-activation result after observing treatment assignment. This mechanism completeness does not replace the paired terminal-outcome comparison.

For a generalization claim, add validation cases that test the same benefit through different realistic situations. They are caller-visible but remain excluded from training calibration. `confirm` evaluates both partitions against the same fixed anchor and seals an evidence claim; it does not select or apply a revision. A trigger-only evaluation may omit behavior cases. If calibration reveals a bad eval, fix it for every arm and prepare a new run so recorded hashes remain meaningful.

The confirmation summary describes what will be measured and the coverage shape. It does not need to expose exact validation prompts or fixture internals.
