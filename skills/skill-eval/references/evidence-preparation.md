# Evidence Preparation Mechanics

Read this before campaign creation for trigger or routing conformance. For other claims, read it after the measurement plan is confirmed and before finalizing or executing the suite.

## Fixtures And Observable Evidence

Fixtures may be synthetic repositories, Git histories, fake CLIs, local services, project conventions, input files, or empty directories. Put executable fake CLIs in `fixture/bin/`; the executor prepends the copied directory to task `PATH` without replacing the outer Claude/Codex host. Model the environment the skill serves rather than copying its authoring repository by default. Fakes may establish mechanism behavior, but do not stub the component claimed to create the outcome benefit.

### Boundary-Stop Gate

For route-only conformance, stop after the route and its directly implicated restraint become observable:

1. Identify the exact command, tool, or handoff selected by the route.
2. Intercept the next unchanged component with a unique sentinel or controlled fast return. Use a fixture `bin/<command>` shim for a direct executable. For `bash path/to/script`, use a fixture `bin/bash` wrapper that matches only the exact script suffix, emits the sentinel, and delegates every other invocation to `/bin/bash`.
3. Put the sentinel and immediate stop instruction in the executor prompt. The executor must stop when it receives that sentinel instead of continuing the target workflow.
4. Prove the returned sentinel with `tool_result_contains` or a structured side-effect check. `tool_called` alone proves launch and does not enforce the stop.

For a shell pipeline, emit the sentinel on `stderr` or write a ledger, return controlled `stdout` for the downstream pipe, and stop the executor after that command. Do not continue the target merely because the intercepted command returned successfully. A shim plus an `exit_success` check on the later workflow is not boundary-stopped.

Give each claim boundary its own stop point. Do not merge a narrow route check and a broad restraint into a full run merely because one run could observe both. For example, when a newly enabled non-interactive route is under test, prove no question was attempted through that route and stop; do not continue through unchanged downstream phases solely to claim that no question occurred anywhere.

Treat a bundled route inside a larger orchestration as interceptable by default. "The decision lives inside the workflow" or "there is no clean interception point" is not a feasibility finding. Propose full execution only when no observable handoff exists, the changed downstream result is part of the claim, or a concrete attempted shim or controlled return would change the behavior being tested. State that specific reason in the confirmation plan.

Declare fixture fidelity and unfrozen external state in the suite. If installed plugins, project rules, MCP servers, network state, organization instructions, user configuration, or mutation authority materially affect the claim, reproduce that constitutive context intentionally or state the resulting ecological-fidelity limit. A repository fixture does not isolate the executor's home directory, installed tools, credentials, or network. External-state entries describe the uncertainty and its effect on the claim; they must not predict that the dependency will be skipped, empty, available, or successful.

Prefer structured side effects over prose tokens. Use output-relative checks for files under `outputs/`; set `root: "workspace"` for fixture-repository files and fake-CLI ledgers. Use `json_pointer_equals` for statuses, booleans, and thread identities. `final_contains` and `final_not_contains` are appropriate only when literal wording is the contract, not for semantic recommendations.

Never describe a workspace ledger or executor-written artifact as unforgeable: the executor can write inside its workspace. When mechanism provenance matters, corroborate the side effect with the matching structured tool invocation or result.

Use structured event evidence for orchestration. `tool_called`, `tool_not_called`, and `tool_call_count` prove invocation; `tool_result_contains` proves that a matching invocation returned the required signal. Match the actual invocation, not a bare filename or payload substring that could appear in a read, search, or written file. For Claude background calls, the immediate "running in background" result proves launch only; assert completion against the preserved result or a downstream artifact.

Use `interactive_prompt_not_used` when a non-interactive contract is material. `exit_success` proves executor health, not that the agent avoided a question before exiting.

## Prerequisites And Multi-Component Treatments

When a load-bearing mechanism exists only in the current snapshot, set `version_scope: "candidate"`, `evidence_role: "mechanism"`, and `prerequisite: true` on a critical deterministic check. The engine gates the current execution on it, omits it from the anchor, and excludes it from comparative pass rates.

A prerequisite may establish that treatment was available and valid, such as authentication succeeding or a schema-valid response returning. It must not select candidate runs based on a favorable post-treatment outcome. A valid empty result, zero findings, or no improvement is scored evidence. Gate only genuine execution failures unless the user defined a different population before evaluation.

For a deterministically activated finite multi-component treatment, prerequisite coverage must establish every activated component. If activation is model-judged, observe the activated set, then verify dispatch and collection for that set. Missing expected activation is scored target behavior. Never require "at least one" treatment result when zero activations are possible. Keep component completeness as supporting mechanism evidence and delivered quality as the terminal comparison.

## Comparison Projection And Git Writes

Qualitative expectations default to `scope: "execution"`. Use `scope: "comparison"` for relative claims and set `comparison_goal: "improve"` when a tie is insufficient or `comparison_goal: "not-worse"` when a tie passes. Split mixed per-output and relative criteria.

When treatment metadata would reveal the candidate, declare `environment.comparison_projection`. Apply narrowly scoped redactions symmetrically to copied filenames, directory names, contents, and evidence strings. `omit_tool_events: true` may withhold tool traces. A projection may remove reviewer, model, or version attribution, never substantive findings, recommendations, errors, or quality differences. Prove omitted mechanism claims separately before blind comparison.

When commit, push, staging, branch state, or `.git` mutation is under test, declare `environment.capabilities: ["git-write"]`. This is accepted only for isolated suites where every behavior case has a fixture. The engine relocates Git metadata inside the disposable workspace and sets `GIT_DIR` and `GIT_WORK_TREE`; local remotes must remain inside that workspace. Do not enable git-write for project-context or live runs.

## Calibration And Replacement Runs

Inspect fixtures and expectations before preparation. Any improvement claim requires anchor and authored arms on the same fixture. For uncertain or qualitative evidence, calibrate the selected scope at one repetition on the invoking host before expanding. Mechanically prevalidated, independent conformance runs may execute ready hosts together. Once evidence is valid, complete confirmed second-host coverage. Add repetitions only when observed disagreement or variance could change the conclusion.

Before `prepare`, perform two literal checks against the finalized suite: every material clause in the campaign goal maps to an expectation, and every claimed boundary stop is implemented by the prompt or fixture rather than merely described by an expectation. Repair either mismatch before freezing evidence.

If calibration exposes an invalid fixture, expectation, prerequisite, or observability assumption, repair the suite, prepare a new run, and repeat the one-repetition calibration without asking again when the measurement goal, hosts, direct-call ceiling, and allowed side effects are unchanged. Frozen evidence is never edited.

Before reusing the campaign, compare the requested adjustment with its exact measurement goal. A measurement repair keeps the campaign. A changed terminal claim or material regression/restraint boundary requires a new campaign; never copy the stale goal into a narrower suite and list the dropped boundary as untested.

## Critique Adjudication

Critics advise; the campaign `measurement_goal` remains scope authority. Every issue from the latest valid critique needs one adjudication disposition:

- `accepted`: a correctable suite defect that will be fixed in a replacement run;
- `rejected`: concrete evidence shows the finding is false or outside the confirmed goal;
- `limitation`: an irreducible constraint narrows an otherwise supportable conclusion;
- `blocked`: the confirmed goal cannot currently be tested.

A critical issue cannot be waived as a limitation. An accepted issue commits to its material substance; do not relabel a critical validity gate as diagnostic. Group duplicate findings, apply all accepted fixes in one replacement draft, and critique that replacement once. Do not rerun critics to search for unanimous approval.

Invalid critic output is a host or response failure, not substantive feedback. Repair and retry the same frozen critique. A blocked or critical-limitation issue stops execution; rejected and non-critical limitations may proceed with the limitation carried into reporting.

## Invalid Checks And Reasoning Checkpoints

When raw output proves that a deterministic check is semantically wrong, run `invalidate-check`. The affected evidence becomes blocked. Replace the check in a new prepared run before comparison or confirmation. Retire a prior campaign case only when the invalidation identifies that case and expectation; otherwise the campaign preserves it as regression evidence.

After each meaningful pass, suite correction, or feasibility change, write one `campaign-checkpoint`. The agent-authored checkpoint records established findings, consequential cross-model or cross-runtime agreement/disagreement/convergence, limitations, next evidence step, and supporting run IDs. It does not copy command narration, prescribe edits as facts, or generate the final report.
