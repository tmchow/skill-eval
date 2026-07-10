# Concepts

Shared domain vocabulary for this project - entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Evaluation Evidence

### Evaluation Run
A frozen evaluation context that binds one target skill, baseline, suite, fixtures, host coverage, versions, and their integrity hashes.

### Fixed Anchor
The immutable baseline against which every candidate must establish benefit: the selected repository version for an existing skill, or normal host behavior with no supplied skill for a new one.

### Skill Version
An immutable skill snapshot evaluated within a run, such as the authored source, fixed anchor, or an automatically revised challenger.

### Evidence Partition
One of two disclosure domains: training evidence may guide revisions, while held-out evidence is reserved for final regression and promotion checks.

### Execution Attempt
A uniquely identified, resumable set of planned host, case, version, and repetition executions whose completed records remain durable across interruption.

### Evaluation Operation
A durable command-lifecycle record for trigger and optimization work. It exposes the active phase, progress, confirmed limits, model-call count, selected candidate, and terminal reason without requiring another model call.

### Evaluation Campaign
A durable link across the calibration, optimization, certification, and confirmation runs serving one measurement goal. It preserves factual run indexes plus append-only agent reasoning checkpoints across interruptions and context compaction.

### Reasoning Checkpoint
An agent-authored interpretation after a meaningful pass: established findings, consequential cross-model signal, limitations, next adjustment, and supporting run IDs. It is durable context, not objective evidence or a generated verdict.

### Benchmark
A comparison-scoped aggregation of objective grades, qualitative preferences, reliability, variance, recorded resource usage, and size deltas for selected attempts.

### Sealed Decision
A hash-bound promotion authorization produced only from complete, passing benchmark evidence and an unchanged winning skill snapshot.

## Relationships

An Evaluation Campaign links Evaluation Runs that share one measurement goal. Each Evaluation Run contains Skill Versions and frozen Evidence Partitions. Execution Attempts collect evidence from those versions. Benchmarks summarize selected attempts against the Fixed Anchor or an incumbent. Reasoning Checkpoints preserve the agent's interpretation between passes. A Sealed Decision authorizes promotion of one version only while those inputs and hashes remain unchanged.
