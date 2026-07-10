---
name: skill-eval
description: Evaluate, compare, benchmark, or optimize agent skills without installing them. Use when validating new, local, committed, branch, or pull-request skill changes; testing behavior or triggering regressions; running blind Claude Code and Codex judgments; or promoting only evidence-backed improvements.
---

# Skill Eval

Evaluate one primary skill with frozen evidence matched to the user's claim. Enter at the user's actual development stage; focused evaluation may finish without optimization or promotion.

## Required Decisions

1. Infer the target and development baseline, then reconstruct the behavioral delta and claims to test.
2. Run preflight before model calls.
3. Select the smallest evidence scope that can prove that claim.
4. Summarize the measurement plan and wait for confirmation.
5. Prepare immutable evaluation inputs for the baseline and current version.
6. Execute only the selected evidence and report what it establishes.
7. Revise, certify, and promote only when the user requested improvement or promotion.

Do not run the full workflow by default. Never bypass confirmation, expose held-out material to a reviser, reuse an attempt ID, or promote from a benchmark summary alone.

Repository source isolation is invariant. Resolve the target first, then read and diff only files under that resolved repository path and frozen snapshots. Ignore any same-name skill content already loaded in the invoking session, and never invoke an installed copy of the target skill for inspection or execution. Installed presence is not a baseline and must not influence suite design.

## Communication Contract

Keep process visibility proportional to its value. Do not narrate every read or command. Batch routine investigation under occasional concise updates, and avoid repeated transition-only updates such as "I'll read this," "Let me check that," or "Next I'll inspect the schema."

Each update should state what is being established, what changed in the evaluation and why it matters, or which decision is next. Include implementation detail only when it changes the validity of the conclusion, model use, or a decision the user must make. Prefer user-facing terms such as baseline/current version, test scenario, evidence, and model runs; omit engine vocabulary such as arms, fixtures, matrices, run directories, traces, schemas, attempts, snapshots, and freezing unless one is necessary to explain validity.

Do not praise or grade the target skill before evidence. For a real blocker, give its cause, impact on the conclusion, and next action; do not walk through the source unless the user asks.

The final response is an evaluation result, not a workflow recap. Lead with the measured outcome and its practical meaning. Do not claim that the whole skill or harness passed when the primary outcome was blocked, degraded, or outside the suite. Do not include unrelated repository work or generic workflow suggestions.

## 1. Target And Preflight

Infer one primary skill from an explicit path/name, PR, the only changed `SKILL.md`, the current skill directory, or one otherwise unambiguous nearby skill. A bare name resolves against the current repository's conventional `skills/` directory and exact frontmatter-name matches; ambiguity requires a path. Report the resolved repository path in the confirmation summary. Ask one short question only when multiple targets remain.

Select the anchor from the requested development scope:

- For a local edit relative to the latest commit, use `HEAD`.
- For a branch or PR, resolve its base from the explicit PR or available repository metadata, then use the merge base of the branch head and base ref. If the requested PR is not checked out, prepare an isolated worktree instead of changing the user's checkout.
- For an explicit comparison ref, use that exact commit.
- If the target does not exist at the selected ref, the engine records a no-skill anchor.

The authored arm is always the current target directory, including committed and uncommitted changes. Honor an explicit user comparison even when another baseline seems plausible. Ask only when multiple base refs remain credible. If anchor and authored hashes are equal, stop before model calls and explain that no comparison delta exists.

Pass the selected commit to `prepare` with `--anchor-ref`; omit it only when `HEAD` is the intended local-edit baseline.

Run:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" preflight --target "<target-skill>" --invoking-host "<claude-or-codex>" --hosts "claude,codex"
```

Block when the invoking host, Bun 1.2+, Git, target, repository, or temporary storage is unavailable. Treat the second host as best effort. Show exact remediation and ask before installing or starting authentication. Read `references/hosts.md` only for host failures or discovery debugging.

Pass only ready hosts to `prepare`; those hosts become the frozen required coverage for that run. An unavailable secondary host is omitted and reported as degraded coverage, while a host that fails after freezing correctly blocks that run's promotion evidence.

If preflight reports possible evaluator-only files, inspect each path before preparation. Keep files needed by the skill at runtime. Pass confirmed answer keys or authoring-only eval specifications with `--exclude-from-executor`; the engine preserves them in frozen source but removes them from every executor copy. Never exclude a runtime reference merely because its name contains `eval`.

## 2. Measurement Plan

Inspect the complete anchor-to-authored diff, not only the working-tree diff, plus the current runtime instructions, directly affected callers, downstream consumers, tests, and outputs. Read `references/eval-design.md` now.

Infer the desired improvement from the user's request and the actual behavioral delta, not from any single narrative artifact. Treat PR descriptions, plans, comments, docs, tests, and existing eval specs as fallible evidence to reconcile with the implementation; an existing eval suite contributes candidate cases but does not define the evaluation scope.

### Outcome Sufficiency Gate

Trace each changed mechanism through immediate effects and consumed outputs to the terminal benefit for the user or downstream consumer. Do not stop at the first observable effect such as a call launching, a result folding in, or a label changing; ask why the change exists. Do not classify the primary claim by the implementation layer: calling a change "orchestration," "routing," or "wiring" does not make mechanism engagement the delivered value.

Presence, provenance, promotion, or formatting of the new mechanism's output is an immediate effect, not the terminal benefit, unless the user explicitly asked to evaluate that effect itself.

When the change claims to alter output quality or usefulness, that outcome is primary; wiring, routing, gates, and fold-in are supporting claims, and unchanged behavior supplies regression claims. A mechanism-only primary is valid only when the user explicitly requests it or no downstream benefit is claimed.

Stochastic or subjective does not mean untestable: use paired anonymous comparison and enough repetitions to characterize disagreement rather than replacing a quality claim with a deterministic proxy.

Before proceeding, complete this sentence internally: "The change exists so `<consumer>` gets `<terminal benefit>`; the improvement case fails when `<benefit is absent even though the mechanism works>`." Do not proceed to confirmation until every claimed benefit has such a case. If the required outcome-producing dependency is unavailable, mark that conclusion blocked or degraded; do not recast the mechanism as the primary claim. State the outcome, supporting mechanisms, and regressions in the confirmation summary so the user can correct the inference before model calls.

Honor explicit user constraints on hosts, cases, repetitions, comparison, budget, or whether to revise; state any resulting limit on the conclusion. Treat words such as "only," "exactly," and "do not" as a hard scope boundary: do not add neighboring cases or stages unless the requested claim is otherwise impossible to test, and ask before doing so.

Evidence modes are composable. Match each claim layer to its evidence:

- For a trigger-only or description-discovery question, run realistic positive and adjacent-negative trigger queries; skip behavior execution and qualitative judges.
- For inspectable routing, files, schemas, commands, or side effects, run focused deterministic checks as mechanism evidence; add transcript grading only for facts the checks cannot observe.
- For output-quality claims, produce paired outputs and use anonymous comparison, with objective regression checks around them.
- When a change has both mechanism and quality claims, run both focused mechanism checks and paired quality comparison. Do not classify it by whichever artifact is easiest to inspect.
- For broad, cross-cutting, or explicitly end-to-end claims, run the smallest branch-complete behavior suite across the required hosts.
- For optimization or promotion, require training and held-out evidence, then run revision and certification. Evaluation-only requests stop after reporting the selected evidence.

Do not expand a narrow request into a whole-skill run merely because the engine supports one. Use the narrowest execution boundary that preserves the causal link between the changed mechanism and the outcome; short-circuit unrelated workflow when the outcome remains observable. Minimization removes redundant evidence within a claim layer, never the outcome layer needed to establish the intended benefit. If focused evidence cannot support a broader conclusion, narrow the conclusion or ask before expanding scope.

Before expensive execution, tell the user only:

- what is being measured;
- how the cases prove the intended improvement;
- the shape of regression and trigger coverage;
- available hosts, which hosts the bounded first pass uses, and degraded coverage;
- the planned direct call count and what remains unknown before calibration;
- what promotion may change.

The user is confirming the measurement scope, coverage, bounded model use, and allowed side effects. Immutability and evidence preparation are internal integrity guarantees, not choices for the user; mention them only when an integrity limitation changes what the evaluation can establish.

Do not invent token totals or wall-clock estimates. Choose the case or query count before asking for confirmation, then state the exact direct-call total for the bounded first pass, not a matrix formula or guessed range. Nested model or subagent work is unknown. Start with one bounded repetition when it can calibrate the claim. Afterward, use observed calibration duration and direct-call expansion to estimate a remaining range and state the assumptions.

Inspect the target for known inner time limits before execution. The executor timeout must exceed any nested model, subagent, or script hard cap plus cleanup time; otherwise the harness can kill a valid run before the target's own bounded work finishes. Do not present a timeout ceiling as an estimate of expected duration.

Keep the confirmation summary under 180 words unless a blocking remediation requires more. Do not enumerate hidden cases, fixtures, skipped subsystems, matrix cells, or model internals. Present the plan as a practical path to evidence, not a warning against running it. End with "Start the first pass?" and wait for confirmation.

## 3. Prepare Evaluation Evidence

After confirmation, author the suite and fixtures in OS temp. Read `references/schemas.md` first. A focused suite may contain only behavior cases or only trigger queries. A promotable behavior revision requires training and held-out behavior cases; description optimization requires positive and difficult adjacent-negative trigger queries in both partitions.

Create one campaign for the confirmed measurement goal before preparing its first run:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" campaign-init --target "<target-skill>" --goal "<confirmed measurement goal>"
```

Keep the returned `campaign_dir` across calibration, optimization, certification, and confirmation runs. If resuming after interruption or context compaction, locate exact-target campaigns with `campaign-list`, select the one matching the user's goal, and read `campaign-context` before continuing. Do not silently reuse a campaign for a different goal.

Fixtures may be synthetic repositories, Git histories, fake CLIs, local services, project conventions, input files, or empty directories. Put executable fake CLIs in `fixture/bin/`; the executor prepends the copied directory to task `PATH` without replacing the outer Claude/Codex host. Model the environment the skill serves rather than copying its authoring repository by default. Fakes may establish mechanism behavior, but do not stub the component claimed to create the outcome benefit.

Inspect fixtures and expectations before freezing. Any claim that the authored version improves on the baseline requires both anchor and authored arms on the same fixture; an authored-only smoke run cannot calibrate improvement. After preparation, calibrate the selected evidence scope at one repetition before expanding or revising. Use observed variance to set further repetitions before drawing a stochastic quality conclusion. Remove redundant cases, strengthen superficial expectations, and repair broken fixtures by discarding that run and preparing a new one; never mutate frozen evidence.

Generate the optional editable suite review only when the user asks to inspect exact cases or agent review cannot establish correctness:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" review-suite --suite "<suite-json>"
```

Freeze the run:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" prepare --target "<target-skill>" --suite "<suite-json>" --invoking-host "<claude-or-codex>" --hosts "<available-hosts>" --campaign "<campaign-dir>" --role "<calibration|optimization|certification|confirmation|other>" [--anchor-ref "<HEAD-or-resolved-merge-base>"] [--exclude-from-executor "<confirmed-evaluator-only-paths>"]
```

Record `run_dir`. `compare` is the default paired evaluation path: it runs training cases, objective and qualitative grading, blind comparison, and a benchmark without requiring held-out cases or creating a promotable decision.

When a claim is a deterministic bundled-script contract, record it without a model run. Run the same check on both versions when claiming improvement. This is supporting mechanism evidence and cannot replace paired outcome evidence:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" check-script --run-dir "<run-dir>" --check-id "<unique-id>" --version "<anchor-or-authored>" --script "<relative-script-path>" [--fixture "<eval-id>"] [--args "<comma-separated-args>"] [--stdout-contains "<expected-text>"]
```

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" compare --run-dir "<run-dir>" --left "anchor" --right "authored" --label "calibration" --hosts "<available-hosts>" --judge-hosts "<available-hosts>" --repetitions 1 [--executor-timeout-ms "<validated-ceiling>"] [--claude-model "<id>"] [--codex-model "<id>"]
```

For trigger-only evaluation, run `trigger` with an explicit `--partition training|holdout|all` for `authored` and for `anchor` when that version exists. For focused objective behavior, use `run` and `grade`; use `compare` whenever the conclusion depends on paired output quality. `certify` is promotion-grade: it requires both training and held-out behavior cases, seals a decision, and is never the calibration command.

`compare`, `certify`, and `optimize` can exceed a harness's foreground command limit. Read `references/hosts.md` before launching one, use the host's native background or persistent-command primitive, and keep the engine command attached to that primitive. The engine persists and grades every completed behavior run and resumes only missing work. Check progress without model calls:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" status --run-dir "<run-dir>"
```

When waiting for a background command, use one completion-aware wait instead of a hand-written polling loop:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" status --run-dir "<run-dir>" --wait --timeout-ms "<foreground-or-known-operation-ceiling>"
```

A timeout is inconclusive evidence, not a regression. Raise the executor ceiling only from a known nested cap or observed calibration, then resume the same labeled workflow; do not discard completed evidence.

Inspect calibration grades, analyzer notes, and artifacts. If both versions pass via the same shortcut, both fail because the fixture is broken, or expectations miss an observed outcome, discard the run and fix the suite for every arm. Otherwise stop after reporting for evaluation-only work, or continue into the requested optimization. Persist a reusable suite only when it has durable value:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" persist-suite --run-dir "<run-dir>"
```

This writes `.skill-eval/<skill-name>/` in the target repository, never inside the distributed skill.

After each meaningful pass, candidate decision, suite correction, or feasibility change, write one agent-authored reasoning checkpoint before presenting the pass update. Read the current run evidence and prior campaign context, then record only the durable interpretation: what was established, consequential cross-model agreement/disagreement/convergence, limitations, the next adjustment, and the supporting run IDs. The checkpoint is not an engine-generated summary and must not copy routine command narration.

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" campaign-checkpoint --campaign "<campaign-dir>" --input "<checkpoint-json>"
```

The deterministic campaign layer collects and indexes facts; it does not generate the final report, infer a verdict, or replace agent judgment.

## 4. Optimize Behavior When Requested

If the current harness exposes `skill-creator`, resolve the directory containing its `SKILL.md` and pass it with `--skill-creator`. The engine injects those current-host instructions into each isolated revision. Otherwise it loads `references/revision.md` as the bundled evidence-driven revision contract.

Pass the invoking session's model ID for its host when known. Do not invent model IDs.

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" optimize --run-dir "<run-dir>" --hosts "<available-hosts>" --judge-hosts "<available-hosts>" --reviser-host "<invoking-host>" --repetitions 3 --max-revisions 5 [--skill-creator "<current-host-skill-creator-dir>"] [--claude-model "<id>"] [--codex-model "<id>"]
```

The command is resumable. It runs exact snapshots through both partitions, deterministic checks, anonymous transcript graders, repetition-aware blind judges, fixed-anchor and incumbent benchmarks, and sealed decisions. A candidate that fails a critical deterministic gate does not spend calls on qualitative grading or comparison. It hard-stops after five challengers or two non-improving passes. Use optional `--max-model-calls` and `--max-elapsed-ms` only when the user confirmed those ceilings.

For every emitted `progress` event, apply the Communication Contract: one short update containing the outcome, most important improvement or regression, and next adjustment. Continue automatically unless dependency/auth remediation or irreducible human judgment is required.

Coverage alone is not cross-model value. When hosts or judges disagree, state the disputed case and practical implication in that pass's update. When a later candidate turns disagreement into agreement, say explicitly that the disagreement became convergence and whether it increased confidence or exposed a portability fix. If only triggering or judging was cross-model while behavior ran on one host, name that boundary rather than implying cross-model behavioral validation.

Objective checks govern observable facts. Anonymous graders govern unsupported transcript expectations. Blind preferences govern comparative quality. Executor self-report proves nothing. Cross-host differences are portability diagnostics, not votes.

## 5. Optimize Triggering When Requested

For a trigger-only evaluation, stop after trigger measurements. When the user asked to improve the description, optimize discovery with three repetitions per query and host:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" optimize-description --run-dir "<run-dir>" --version "<behavior-incumbent>" --hosts "<available-hosts>" --improver-host "<invoking-host>" --repetitions 3 --max-iterations 5 --minimum-improvement 0.05 [--max-model-calls "<confirmed-ceiling>"] [--max-elapsed-ms "<confirmed-ceiling>"] [--claude-model "<id>"] [--codex-model "<id>"]
```

The improver sees training failures only. The engine selects by held-out score, records per-query stability, and limits descriptions to supported scope. Relay description progress with the same concise update rule.

When behavior cases are in scope and the selected version differs from the behavior incumbent, certify it against the complete frozen behavior suite:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" certify --run-dir "<run-dir>" --candidate "<description-winner>" --incumbent "<behavior-incumbent>" --label "final-description" --hosts "<available-hosts>" --judge-hosts "<available-hosts>" --repetitions 3 [--claude-model "<id>"] [--codex-model "<id>"]
```

Trigger gains never excuse a behavioral regression.

## 6. Resolve Disputes

Read the sealed benchmarks, analyzer notes, grades, judge rubrics, and raw artifacts. Generate the review page only when anonymous agents genuinely disagree on a subjective decision or the user asks. Read `references/human-review.md` now and follow it.

The page is a read-only evidence viewer served at a temporary localhost URL. Collect each decision through the current harness's native interaction capability and record it directly as evaluation evidence. Never expose version labels before the user answers. Human judgment adjudicates only the matching anonymous comparison; it never edits an existing benchmark or waives objective gates.

## 7. Report, Then Promote When Requested

Before the final report, and whenever continuing after context compaction, regenerate the factual packet and reason over it:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" campaign-context --campaign "<campaign-dir>"
```

Use the campaign context as a loss-resistant index, not as an authority. Re-open the raw artifacts behind any material or surprising claim. The final synthesis is agent-authored from the measurement goal, verified evidence, and reasoning checkpoints.

Begin the final response with one plain-language outcome sentence, followed by a compact quantitative block in this order:

1. **Measured change:** the primary before -> after metric, including held-out results or blind preference when applicable.
2. **Evidence coverage:** cases, repetitions, hosts, critical gates, and regression results.
3. **Cross-model signal:** the consequential agreement, disagreement, or convergence; say when only one host exercised behavior.
4. **Execution scale:** observed direct model calls and elapsed time when available.
5. **Not established:** the most important outcome or dependency the suite did not exercise.

Include only artifact-supported measurements relevant to the claim: critical gates, script checks, training and held-out pass rates, standard deviation and stability, blind preference agreement, trigger precision/recall/false-trigger rate, duration, tool errors, and skill-byte delta. Do not report dollar cost. Report tokens only when the user requested them, set a token budget, or token usage is itself an evaluation target. Use `unavailable` instead of reconstructing precision from event-file counts.

Keep the verdict calibrated to the measured scope. A harness that exposed limitations did not globally "pass the pressure test," and a target whose terminal benefit was not exercised is not globally "verified." End after the result and its material limitation; do not append unrelated cleanup, shipping, or other-skill suggestions.

An evaluation-only run ends with the evidence report. Promotion requires an explicit improvement or promotion request and the `decision_id` returned by final accepted behavior certification:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" promote --run-dir "<run-dir>" --decision "<decision-id>" [--policy-allows-commit]
```

The engine revalidates decision, benchmark, version, suite, fixture, and authored-target hashes. It applies only the sealed winner, backs up the original, leaves dirty/untracked/protected-branch or policy-restricted work uncommitted, creates at most one final commit when allowed, and never pushes. Report the final diff or commit, run artifact path, measured benefit, coverage limitations, and remaining weak signals.
