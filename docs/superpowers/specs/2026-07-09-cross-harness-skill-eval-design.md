# Cross-Harness Skill Eval Design

**Date:** 2026-07-09

**Status:** Approved design

**Repository:** `tmchow/skill-eval`

## Goal

Build one portable `skill-eval` plugin that evaluates and improves agent skills from Claude Code or Codex. The invoking agent uses the best native capabilities of its host while a shared Bun engine makes execution reproducible across both harnesses.

The product must answer two questions with evidence:

1. Did the skill or revision produce the intended behavioral improvement?
2. Did it avoid regressions, trigger drift, and downstream unintended consequences?

The default evaluation runs Claude and Codex when both are installed. Cross-harness execution is best-effort: unavailable hosts lower coverage and produce a warning, but do not prevent promotion when every available host passes.

## Version Terms

- **Anchor baseline:** the fixed comparison captured at run start: `HEAD` for a tracked revision or no skill for a new skill.
- **Authored candidate:** the user's working-tree skill at run start.
- **Incumbent:** the best skill version found so far; initially the authored candidate after it is measured against the anchor baseline.
- **Challenger:** the single evidence-driven revision proposed in an optimization iteration.

The anchor baseline never moves during a run. Incumbent-versus-challenger comparisons select better revisions while the anchor preserves the original value and regression comparison.

## Product Boundary

`skill-eval` owns evaluation and the closed optimization loop. It does not duplicate general skill-authoring guidance.

- The current host's installed `skill-creator` produces candidate revisions when available.
- A bundled, evidence-driven revision contract is the fallback when no `skill-creator` is available.
- The evaluator may change any file inside the target skill directory, including references, scripts, assets, and metadata.
- Frozen evals, fixtures, and files outside the target skill directory are never revision inputs.
- One primary skill is evaluated at a time. Related routers, sibling skills, or dependencies may be declared when realistic invocation depends on them.
- The same target skill bytes run on Claude and Codex. Host-specific target variants are out of scope.

The initial release does not evaluate whole plugins as a unit, support native Windows, submit to official marketplaces, or mutate production systems during eval runs.

## Distribution

The public MIT-licensed repository is both the plugin source and a self-hosted marketplace for Claude Code and Codex.

```text
skill-eval/
  .claude-plugin/
    plugin.json
    marketplace.json
  .codex-plugin/
    plugin.json
  .agents/plugins/
    marketplace.json
  skills/skill-eval/
    SKILL.md
    scripts/
    references/
      agents/
      hosts/
      schemas/
    assets/
  tests/
```

Both hosts expose one `skill-eval` skill from the same `SKILL.md`. Small host references and runtime adapters handle native invocation differences without forking the workflow.

The implementation is a clean-room Bun/TypeScript system. Documentation credits the Anthropic `skill-creator` eval methodology as inspiration without copying its Apache-2.0 implementation.

## Architecture

The current Claude or Codex agent is the intelligent orchestrator. The shared engine is deterministic infrastructure.

### Agent Responsibilities

- Infer the target and baseline.
- Build the change hypothesis and impact map.
- Design and calibrate evals and fixtures.
- Delegate challengers to the current host's `skill-creator` or the fallback reviser.
- Read raw artifacts and reconcile mechanical grades with blind judges.
- Explain each iteration succinctly.
- Decide pass, fail, blocked, or promote.

### Engine Responsibilities

- Run preflight checks and approved remediation.
- Create isolated workspaces and exact fixture copies.
- Spawn Claude and Codex CLI processes.
- Capture JSONL events, final messages, outputs, timings, tokens, and errors.
- Enforce schemas and source hashes.
- Run deterministic checks and aggregate statistics.
- Randomize blind-comparison labels.
- Store run artifacts and serve the optional review UI.
- Apply the promoted winner safely.

The engine never decides which qualitative output is better and never authors skill changes.

## User Experience

### Target Inference

When invoked without a path, infer the target from, in order:

1. A skill named in the conversation.
2. The only changed `SKILL.md` in the current repository.
3. A current directory that is itself a skill.
4. A single otherwise-unambiguous candidate discovered nearby.

The user confirms the inferred target before the expensive run begins. Ambiguous targets require a short choice rather than a guess.

### Start Gate

Before model calls, show a concise, decision-relevant summary. It states:

- what behavioral change or skill value is being measured;
- how the evals will prove the intended improvement;
- the shape of regression and trigger coverage;
- which harnesses are available;
- a practical time/call estimate;
- what promotion may change.

Do not expose the internal matrix, model identifiers, fixture mechanics, or every preflight check unless an exception affects the decision.

Example:

> Ready to evaluate `skills/example-skill`.
>
> **What I'm testing:** whether the revision makes fallback routing default-closed when the required tool is unavailable.
>
> **How I'll prove it:** targeted cases where the committed skill takes the old shortcut, plus regression coverage for the normal path, explicit opt-in, related router handoff, and Claude/Codex triggering.
>
> I'll compare the working version against `HEAD` across both available harnesses and try up to five evidence-driven revisions. This may take 20-40 minutes. A winner must demonstrate the intended improvement without a critical regression.
>
> Start the evaluation?

After confirmation, the loop is automatic. It pauses only for approved dependency/authentication remediation or genuinely irreducible human judgment.

### Iteration Updates

After each pass, report only:

- the observed outcome;
- the most important improvement or regression;
- what the next challenger will adjust.

Example:

> Iteration 2/5: the new routing fixed both fallback cases, but Codex regressed on the opt-in path. I'm narrowing the gate and rerunning that boundary.

Detailed evidence remains in run artifacts.

## Preflight

Preflight finishes before fixtures or model calls. It writes `preflight.json` with `ready`, `degraded`, and `blocked` checks.

It verifies:

- supported Bun version;
- Git availability and target repository state;
- invoking harness installation and authentication;
- other harness installation and authentication;
- writable temporary storage;
- target skill readability and baseline availability;
- scenario-specific tools, credentials, and network requirements.

Missing requirements trigger interactive remediation. The skill offers the exact fix and, after approval, performs supported installation or launches the authentication flow. Nothing installs silently.

The invoking harness is required. The other harness is optional: its absence marks cross-harness coverage degraded.

## Baseline Selection

For a tracked revision, capture the target skill at `HEAD` as the anchor baseline and compare the authored working-tree candidate against it. Allow explicit Git-ref and path overrides.

For a new or untracked skill with no prior version, compare against a no-skill baseline.

Snapshot anchor-baseline and authored-candidate bytes before the run. The engine hashes every source tree before and after executor runs to prove the authored sources were not mutated.

## Impact Mapping And Eval Creation

Eval creation begins from the changed mechanism, not the visible bug or a collection of prompt paraphrases.

For revisions, inspect the working-tree diff and establish:

- the intended behavior change;
- changed routing, gates, completion contracts, reference loading, output formats, tool calls, portability, or validation;
- every affected branch;
- likely baseline shortcuts and rationalizations;
- related callers and sibling routes;
- emitted files, schemas, menus, handoffs, and side effects;
- neighboring behavior expected to remain stable.

Build a branch matrix from that impact map. Consider default, opt-in, skip/default-closed, unsupported/unavailable, exception, user-says-only, ambiguous-input, and format/mode paths when they are relevant.

Create the smallest nonredundant eval set that covers every material boundary. Each case should prove one boundary and have one of these purposes:

- `improvement`: old behavior should fail or take the known shortcut while the evaluated version succeeds;
- `regression`: behavior outside the intended change must remain stable;
- `restraint`: the new rule must not fire;
- `fallback`: unavailable, unsupported, or exception behavior;
- `trigger`: discovery should or should not load the skill.

Every case carries categorical expectations:

- `critical`: a regression blocks promotion;
- `quality`: contributes to comparison and preference;
- `diagnostic`: informs analysis without deciding the winner.

Prefer inspectable evidence such as files, commands, reference loads, omitted prompts, routing decisions, schemas, and observable side effects. Executor self-report is never sufficient proof.

## Agent-Designed Fixtures

Preserve the successful Claude `skill-creator` pattern: fixture design is an agent judgment, not a rigid universal schema.

The eval designer may create whatever environment makes the scenario realistic, including:

- individual input files;
- a synthetic repository;
- Git history and branches;
- fake CLIs or local services;
- project conventions and instruction surfaces;
- no fixture at all.

The target skill's authoring repository is not copied by default. It is where the skill lives, not necessarily the environment the skill serves. A real-project fixture is an explicit exception.

The harness enforces reproducibility around this flexible design:

1. Finalize prompt, fixture, expected evidence, and expectations before launching executors.
2. Freeze the fixture as opaque bytes.
3. Create identical fresh copies for every configuration.
4. Record fixture hashes and setup logs.
5. Exclude eval definitions and held-out cases from executor context.

If later analysis exposes a bad fixture or missing assertion, revise the eval and rerun the anchor baseline, incumbent, and challenger as applicable. Never change the test only for the challenger.

## Eval Calibration And Persistence

Generated evals begin in the temporary run workspace. Before optimizing the skill:

1. Run the authored candidate and anchor baseline to determine whether the cases are meaningful.
2. Remove duplicates and sharpen trivially satisfied expectations.
3. Ensure at least one pressure case captures the old shortcut and rationale when applicable.
4. Ensure negative, fallback, and adjacent regression coverage matches the impact map.
5. Freeze a core suite and a held-out subset.

The revision agent receives training failures and generalized takeaways, not held-out prompts or expected answers. Held-out results decide promotion.

Do not store generated evals inside the target skill. That would distribute authoring debris and could leak expected behavior to executors.

Persist only calibrated, reusable suites under the target repository's `.skill-eval/<skill-name>/`. Executors never receive `.skill-eval/`. Complete run artifacts live under `/tmp/skill-eval/<skill-name>/<run-id>/`.

## Behavioral Execution Matrix

The initial behavioral pass runs a full matrix when both harnesses are available:

| Executor | Anchor baseline | Authored candidate |
|---|---:|---:|
| Claude | yes | yes |
| Codex | yes | yes |

Each optimization iteration uses the same shape with incumbent and challenger. Preserve the fixed anchor results for absolute value and regression comparison. Rerun the anchor whenever the eval or fixture changes; otherwise reuse its frozen-run evidence rather than spending calls without changing the tested contract.

Use one run per configuration initially. Expand ambiguous, conflicting, or near-threshold cases to three runs. Keep prompts, fixtures, permissions, and declared related skills identical within a case.

Behavioral runs receive the exact skill path explicitly, bypassing installed-skill caches. They do not test discovery.

## Trigger Evaluation

Trigger evals test real host discovery separately from behavior.

Infer and record intended reach as `user`, `model`, or `mixed`, with user override. User-invoked skills prioritize explicit invocation and quiet implicit behavior; model-invoked skills optimize implicit discovery.

Description candidates must:

- state the job first;
- route distinct body-supported intents;
- use natural user trigger language;
- name caller relationships only when they affect routing;
- avoid duplicate triggers and unsupported promises;
- avoid summarizing enough workflow to suppress loading `SKILL.md`.

Generate positive prompts from distinct supported intents and difficult negatives from adjacent intents and shared terminology. Run each query three times on each available harness. Measure precision, recall, false-trigger rate, and stability on training and held-out queries.

Trigger runs place the identical target skill in an isolated project-local discovery location and submit the raw prompt without naming the skill.

## Grading And Blind Preference

Objective expectations use deterministic checks whenever possible. Mechanical results govern objective facts but do not decide qualitative quality.

Qualitative comparisons use both harnesses as independent judges when available:

1. Compare challenger versus incumbent within Claude.
2. Compare challenger versus incumbent within Codex.
3. Randomize A/B labels independently for every judge.
4. Give both judges the same task, rubric, artifacts, and expectations without executor or version identity.
5. Record agreement, disagreement, and evidence.

Cross-harness challenger comparisons are portability diagnostics, not promotion votes. They must not confuse inherent model differences with skill improvement.

When judges disagree, the invoking orchestrator reads the raw outputs and transcripts. Raw inspection governs quality, mechanical checks govern objective facts, and executor self-reports govern nothing on their own.

Open the review UI only when raw-artifact adjudication genuinely cannot resolve a subjective decision or when the user explicitly asks to inspect outputs. The UI shows only the disputed cases and required decision by default.

## Revision Loop

Produce one evidence-driven challenger per iteration.

1. Summarize training failures and likely causes without exposing held-out cases.
2. Invoke the current host's `skill-creator` when available.
3. Otherwise use the bundled minimal revision contract.
4. Revise an isolated copy of the complete incumbent skill directory.
5. Run the behavioral matrix and judge it.
6. Promote the challenger to incumbent only when it clears critical gates against both the incumbent and fixed anchor on available hosts and demonstrates improvement.

Behavior optimization runs before description optimization. Apply the winning description to the behavioral winner, then rerun the complete frozen behavioral suite.

Allow at most five revision iterations total across behavior and description. Trigger measurements and final regression runs do not consume revision iterations. Stop earlier when:

- all critical gates pass and the intended improvement is demonstrated;
- two consecutive challengers make no meaningful improvement;
- the creator cannot produce a materially different challenger;
- a required capability is genuinely blocked.

If no challenger beats the authored candidate, retain the authored candidate and report what the eval established. If the authored candidate itself fails to beat the anchor baseline, retain the user's working tree and report that the intended revision was not demonstrated; do not silently restore or overwrite it.

## Measurement And Reporting

Quantify version effects wherever artifacts support a meaningful comparison. Report decision-relevant behavioral success, triggering quality, reliability, execution cost, and skill footprint. Include improvements and regressions and finish with a net-benefit judgment.

Examples of useful measurements include pass/fail counts, critical-gate status, preference agreement, false-trigger rate, variance, duration, token usage, tool calls, and always-loaded skill weight. These are examples, not a mandatory catalog. Do not invent precision or report metrics that do not affect the decision.

The final result distinguishes:

- `improvement demonstrated`;
- `no regression found`;
- `non-discriminating eval`;
- `blocked or limited signal`.

## Safety And Isolation

Every executor works in an isolated scratch copy. Writes are allowed only there by default. Network access, live credentials, external messages, and production mutations require explicit scenario opt-in during preflight.

The engine must:

- prevent source-repository writes by executors and judges;
- redact secrets from stored event streams where feasible;
- use bounded concurrency;
- time out hung processes;
- retain partial artifacts after interruption;
- treat malformed or incomplete host output as a failed run, not a passing omission;
- preserve enough state to diagnose or resume a run without reusing contaminated executor workspaces.

## Promotion And Git Behavior

Never commit intermediate candidates.

When a final winner is selected:

- update the authored target skill;
- preserve the original snapshot and final diff in the run workspace;
- if the repository started clean, the target is tracked, the branch is not protected/default, and project policy permits commits, create one final commit;
- if the repository started dirty or the target was untracked, apply the winner but leave it uncommitted;
- if project policy forbids a direct commit, leave a reviewed diff;
- never push automatically.

## Degraded And Failure Behavior

- Missing secondary harness: warn, evaluate available hosts, and permit promotion based on successful coverage.
- Missing invoking harness dependency: block before model calls and offer remediation.
- One executor failure: retry within bounded policy, then mark that configuration failed or unavailable.
- One judge unavailable: continue with the remaining judge and lower confidence.
- Artifact cannot be inspected reliably: mark affected expectations blocked rather than guessing.
- Human judgment remains irreducible after agent adjudication: open the focused UI and pause.
- Interrupted run: keep partial artifacts and a machine-readable run state; never promote an incomplete candidate.

## Testing Strategy

Deterministic CI uses fake `claude` and `codex` executables that emit controlled event streams and artifacts.

Tests cover:

- target inference and confirmation gating;
- preflight readiness, degradation, and remediation routing;
- baseline selection and source snapshots;
- impact-map-to-eval coverage contracts;
- fixture identity across configurations;
- matrix construction and adaptive repetition;
- held-out isolation and leakage prevention;
- target-source mutation detection;
- trigger detection on both host adapters;
- blind label randomization;
- categorical expectation aggregation;
- dual-judge agreement and disagreement;
- metric and skill-weight deltas;
- unavailable artifact inspectors;
- timeouts, malformed JSONL, partial runs, and interruption recovery;
- dynamic promotion and Git behavior;
- both plugin and marketplace manifests.

Live smoke tests against installed CLIs are opt-in and separate from deterministic CI.

The first dogfood run targets `trevin-write-skill`: make a controlled behavior revision, generate mechanism-based evals, execute the cross-harness matrix, and verify that the evaluator distinguishes improvement from no regression without opening the UI unnecessarily.

## Acceptance Criteria

The initial release is complete when:

1. The same installed `skill-eval` workflow runs from Claude Code and Codex.
2. Either host can launch fresh local runs on both available harnesses without installing the target skill.
3. A revised tracked skill uses `HEAD` as a fixed anchor baseline; a new skill uses no skill.
4. Agent-designed fixtures are frozen and copied identically across the matrix.
5. Before confirmation, the proposed eval plan covers intended improvement and a justified regression envelope; after confirmation, the generated suite is calibrated and frozen before optimization.
6. Mechanical and dual blind qualitative grading produce auditable artifacts.
7. The invoking agent reads raw artifacts and owns the verdict.
8. The loop can revise, evaluate, measure, and promote a winner automatically within five total revisions.
9. Missing secondary harnesses degrade visibly without blocking otherwise valid promotion.
10. The UI remains closed unless human judgment is genuinely required or explicitly requested.
11. Promotion updates only the target skill, follows dynamic Git policy, and never pushes.
12. Deterministic fake-harness tests and both plugin validations pass in CI.
