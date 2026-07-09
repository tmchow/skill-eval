# Eval Design And Calibration

Read this reference before proposing the confirmation summary or authoring a suite.

## Start From The Mechanism

Do not build a prompt list from the visible symptom alone. For a revision, inspect the diff and identify what mechanism changed: routing, a gate, completion criteria, reference loading, output format, tool selection, portability, side effects, or validation.

Map:

- the desired change;
- every branch affected by the mechanism;
- shortcuts or rationalizations the old version may take;
- callers, sibling routes, and handoffs;
- emitted files, schemas, menus, and side effects;
- behavior outside the change that must remain stable.

For a new skill, derive the same map from the value claim and likely no-skill behavior.

## Build A Branch Matrix

Consider only branches relevant to the mechanism:

- default and explicit opt-in;
- skip or default-closed;
- unavailable, unsupported, and exception paths;
- user-says-only or constrained modes;
- ambiguous inputs;
- format and output modes;
- downstream consumer or router behavior.

Create the smallest set where each case proves one material boundary. More paraphrases of the same branch are not broader coverage.

Assign each case one purpose:

- `improvement`: distinguishes the intended gain from the anchor;
- `regression`: protects behavior outside the change;
- `restraint`: proves the new rule does not fire;
- `fallback`: exercises unavailable or exception behavior;
- `trigger`: tests discovery separately from execution.

Assign `critical`, `quality`, or `diagnostic` severity. A critical failure blocks promotion.

## Prefer Inspectable Evidence

Prefer files, schemas, command traces, loaded references, routing decisions, omitted prompts, and observable side effects. Use deterministic checks for objective facts. Reserve natural-language expectations for blind qualitative judges.

The executor's claim that it succeeded is not evidence. A filename alone is weak evidence when content can be inspected.

## Design Real Fixtures

The fixture should resemble the environment the skill serves, not necessarily the repository where the skill is authored. Use a synthetic repository, Git history, fake CLI, local service, project conventions, input files, or no fixture. Freeze opaque bytes and copy them fresh for every arm.

Never include the suite, expected answers, comparison labels, or held-out cases in an executor workspace.

## Calibrate Then Freeze

Run anchor and authored candidate before revision. Remove cases where both versions pass for the same shortcut, both fail because the fixture is broken, or multiple prompts prove the same boundary. Strengthen expectations that can pass superficially.

Hold out cases that test the same mechanism through a different realistic situation. Include at least one training and held-out behavior case; description optimization also needs positive and difficult negative trigger queries in both partitions. The engine passes only generalized training failures to revisers and uses held-out evidence for selection. If calibration reveals a bad eval before freezing, fix it for every arm. After freezing, create a new run so recorded hashes remain meaningful.

The confirmation summary describes what will be measured and the coverage shape. It does not need to expose held-out cases or fixture internals.
