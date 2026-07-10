# Eval Design And Calibration

Read this reference before proposing the confirmation summary or authoring a suite.

## Match Evidence To The Question

Start from what the user asked to learn or improve. A trigger question needs trigger queries, not a full skill execution. An inspectable routing or artifact claim should use focused cases and objective checks. A quality claim needs representative outputs and anonymous comparison. These modes compose when one change has both kinds of claim. Reserve a full end-to-end suite for changes whose effects cross the workflow or for conclusions explicitly scoped to the whole skill.

User constraints on cases, hosts, repetitions, comparison refs, budget, or evaluation-only versus revision are part of the contract. Follow them unless they make the requested conclusion unsupported; in that case explain the narrower claim before execution.

Treat PR descriptions, plans, comments, docs, tests, and authored eval specs as candidate evidence, not scope authority. They may be stale, incomplete, or focused on one layer. Reconcile them with the complete anchor-to-authored implementation, its runtime dataflow, and the user's current request. Compare existing tests and evals with the independently derived claim map: reuse valid cases, add missing claim layers, and reject expectations contradicted by current behavior. Their silence does not prove that an outcome is out of scope. When sources conflict, state the inferred claim and uncertainty in the confirmation summary instead of silently choosing the easiest artifact to test.

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

Create the smallest set where each case proves one material boundary. More paraphrases of the same branch are not broader coverage. Minimize redundant proofs within the mechanism, outcome, and regression layers; do not remove a required layer merely because another is cheaper to inspect.

Assign each case one purpose:

- `improvement`: distinguishes the intended gain from the anchor;
- `regression`: protects behavior outside the change;
- `restraint`: proves the new rule does not fire;
- `fallback`: exercises unavailable or exception behavior;
- `trigger`: tests discovery separately from execution.

Assign `critical`, `quality`, or `diagnostic` severity. A critical failure blocks promotion.

## Prefer Inspectable Evidence

Prefer files, schemas, command traces, loaded references, routing decisions, omitted prompts, and observable side effects. Use deterministic checks for objective facts. Use `tool_called`, `tool_not_called`, or `tool_call_count` against structured host event traces when the claim is whether orchestration launched a command or tool; do not demote that fact to a model grader. Reserve natural-language expectations for blind qualitative judges.

The executor's claim that it succeeded is not evidence. A filename alone is weak evidence when content can be inspected.

Objective mechanism evidence and qualitative outcome evidence are complementary. If the claimed benefit is produced by an external model, tool, reference, or downstream stage, a fake can validate routing and failure handling but cannot prove the benefit. Do not stub the component claimed to create the benefit in the outcome case.

If that outcome-producing dependency is unavailable, mark that outcome blocked or degraded. Do not silently replace it with a stub, narrow the suite to mechanism checks, and still report an improvement evaluation.

Do not replace a stochastic or subjective quality outcome with a deterministic proxy merely because the proxy is cheaper. Use objective checks to prove the causal path and anonymous repeated comparison to judge the quality claim.

Do not require byte equality between independent model runs unless the output is deterministic by contract. For stochastic outputs, protect objective invariants mechanically and judge quality or non-regression through anonymous comparison across repetitions.

## Design Real Fixtures

The fixture should resemble the environment the skill serves, not necessarily the repository where the skill is authored. Use a synthetic repository, Git history, fake CLI, local service, project conventions, input files, or no fixture. Place executable fake commands under the fixture's `bin/` directory; it is prepended to the executor task's `PATH`. Freeze opaque bytes and copy them fresh for every arm.

Use the narrowest execution boundary that preserves the causal link to the claim. A trigger or routing claim may stop before full execution. An outcome claim may bypass unrelated setup and exercise the changed stage directly, but it must still produce the artifact or behavior the real consumer receives. Design at least one representative fixture where the claimed delta could appear; if both arms are structurally unable to diverge, the fixture cannot calibrate improvement.

Never include the suite, expected answers, comparison labels, or held-out cases in an executor workspace.

## Calibrate Then Freeze

Run anchor and authored candidate on the same fixture before revision whenever the claim is comparative. An authored-only run can prove operability, not improvement. Remove cases where both versions pass for the same shortcut, both fail because the fixture is broken, or multiple prompts prove the same boundary. Strengthen expectations that can pass superficially.

One repetition may calibrate feasibility and direct-call expansion. Do not treat it as sufficient evidence for a stochastic quality claim; use observed variance and disagreement to choose further repetitions before reporting the outcome as established.

Hold out cases that test the same mechanism through a different realistic situation. Optimization or promotion needs at least one training and held-out behavior case; a trigger-only evaluation may omit behavior cases. Description optimization needs positive and difficult negative trigger queries in both partitions. The engine passes only generalized training failures to revisers and uses held-out evidence for selection. If calibration reveals a bad eval before freezing, fix it for every arm. After freezing, create a new run so recorded hashes remain meaningful.

The confirmation summary describes what will be measured and the coverage shape. It does not need to expose held-out cases or fixture internals.
