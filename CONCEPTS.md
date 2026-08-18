# Concepts

Shared vocabulary for Skill Eval. This glossary describes the evaluator's evidence model, not an authoring or mutation workflow.

## Evaluation Evidence

### Evaluation Run
An immutable context binding one target skill, fixed anchor, suite, fixtures, requested hosts, skill snapshots, and integrity hashes.

### Fixed Anchor
The baseline against which the current skill must establish benefit: a selected repository snapshot for an existing skill, or normal no-skill host behavior for a new one.

### Skill Version
An immutable snapshot executed within a run. The product compares `anchor` and `authored`; it does not create revised versions.

### Evidence Role
`outcome` evidence directly supports the terminal user hypothesis. `mechanism` evidence explains or gates the causal path. A critical mechanism failure can block success, but a passing mechanism cannot create an effectiveness win.

### Evidence Partition
`training` evidence calibrates the suite and diagnosis. `validation` evidence tests the same confirmed claim in separate caller-visible situations. Validation is distinct evidence, not a secret selection input.

### Claim Class
The maximum conclusion a suite supports: conformance validates a contract, effectiveness compares user value against a fixed anchor, and generalization adds outcome evidence across both partitions and material regressions.

### Suite Critique
An independent pre-execution judgment of whether scenarios, fixtures, baseline, expectations, and blind projection can answer the confirmed hypothesis. Critics advise; the campaign measurement goal remains scope authority.

### Environment Fidelity
The ambient host and project context available to a run: repeatable isolation, project-aware execution, or live execution, with unfrozen external dependencies declared.

### Runtime Profile
The effective role, harness, model, reasoning effort, context mode, and capability scope for one model-backed call. Behavior and evaluator profiles remain distinct so ceiling-model judgment does not imply behavior portability.

### Expectation Scope
Execution-scoped qualitative claims can be judged from one anonymous output. Comparison-scoped claims require both anonymous outputs and state whether improvement or non-regression is required.

### Invalidated Check
A deterministic expectation discovered to measure the wrong semantic property. Its evidence is blocked and may support a hash-bound campaign case retirement; it is never reinterpreted as a pass.

### Execution Attempt
A resumable set of planned host, case, version, and repetition cells. Completed cells remain immutable across interruption.

### Benchmark
A comparison-scoped aggregation of outcome grades, blind pair preferences, critical mechanism gates, variance, reliability, and recorded execution scale.

### Evidence Index
A deterministic, hash-bound inventory of run facts: coverage, grades, judgments, failures, invalidations, benchmarks, and missing hosts. It contains no agent diagnosis or advice.

### Evidence Claim
A hash-bound confirmation artifact over the fixed anchor, authored snapshot, both evidence partitions, exact requested hosts, and passing benchmark. It records what the evidence supports and authorizes no mutation.

## Campaign Continuity

### Evaluation Campaign
A durable link across calibration, replacement, and confirmation runs serving one unchanged measurement goal and fixed anchor. It protects prior case and trigger IDs from silent removal.

### Case Retirement
An explicit, hash-bound record that removes a prior case only because matching invalidated-check evidence demonstrates that its expectation was unsound.

### Reasoning Checkpoint
An agent-authored interpretation after a material pass: established findings, consequential cross-model signal, limitations, next evidence step, and supporting run IDs. It preserves reasoning through context compaction but is not objective evidence.

## Relationships

An Evaluation Campaign pins the measurement goal and Fixed Anchor. Each Evaluation Run freezes a suite and Skill Versions. A Suite Critique validates design before effectiveness evidence is collected. Execution Attempts produce outcome and mechanism evidence under recorded Runtime Profiles. Benchmarks compare anchor with authored, while Invalidated Checks block unsound evidence. The Evidence Index preserves facts; Reasoning Checkpoints preserve interpretation. Confirmation seals an Evidence Claim, and the calling authoring workflow decides whether and how to edit the skill before invoking Skill Eval again.
