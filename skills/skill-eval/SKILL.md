---
name: skill-eval
description: Evaluate, compare, benchmark, or optimize agent skills without installing them. Use when validating skill revisions, testing behavior and triggering regressions, comparing against Git HEAD or no-skill baselines, running blind Claude Code and Codex judgments, or promoting only evidence-backed improvements.
---

# Skill Eval

Evaluate one primary skill through frozen behavior, trigger, regression, and cross-harness evidence. Own the final interpretation; let the engine enforce provenance, holdouts, iteration limits, and promotion gates.

## Required Flow

1. Infer the target and intended improvement.
2. Run preflight before model calls.
3. Design and calibrate a training/holdout suite from the changed mechanism.
4. Summarize the measurement plan and wait for confirmation.
5. Freeze the suite, fixtures, fixed anchor, and authored candidate.
6. Run or resume automatic behavior optimization.
7. Optimize triggering only after behavior converges.
8. Certify the complete behavior suite after any description change.
9. Promote only the version named by a sealed decision.

Never bypass confirmation, expose held-out material to a reviser, reuse an attempt ID, or promote from a benchmark summary alone.

## 1. Target And Preflight

Infer one primary skill from an explicit path/name, the only changed `SKILL.md`, the current skill directory, or one otherwise unambiguous nearby skill. Ask one short question only when multiple targets remain.

For a tracked target, the engine uses its directory at Git `HEAD` as the fixed anchor. For a new or untracked target, it uses no skill. The anchor never moves.

Run:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" preflight --target "<target-skill>" --invoking-host "<claude-or-codex>" --hosts "claude,codex"
```

Block when the invoking host, Bun 1.2+, Git, target, repository, or temporary storage is unavailable. Treat the second host as best effort. Show exact remediation and ask before installing or starting authentication. Read `references/hosts.md` only for host failures or discovery debugging.

Pass only ready hosts to `prepare`; those hosts become the frozen required coverage for that run. An unavailable secondary host is omitted and reported as degraded coverage, while a host that fails after freezing correctly blocks that run's promotion evidence.

## 2. Measurement Plan

Inspect the target, its working-tree diff, and directly affected callers or outputs. Read `references/eval-design.md` now.

Infer the desired improvement, changed mechanism, affected branches and shortcuts, downstream handoffs, stable neighboring behavior, and intended trigger reach (`user`, `model`, or `mixed`). Build the smallest nonredundant suite that proves the gain and covers justified regressions.

Before expensive execution, tell the user only:

- what is being measured;
- how the cases prove the intended improvement;
- the shape of regression and trigger coverage;
- available hosts and degraded coverage;
- practical time/call expectations;
- what promotion may change.

Do not enumerate hidden cases, fixtures, matrix cells, or model internals. Ask to start and wait for confirmation.

## 3. Author And Freeze

After confirmation, author the suite and fixtures in OS temp. Read `references/schemas.md` first. A promotable suite must contain both training and held-out behavior cases. Trigger optimization additionally requires positive and difficult adjacent-negative queries in both partitions.

Fixtures may be synthetic repositories, Git histories, fake CLIs, local services, project conventions, input files, or empty directories. Model the environment the skill serves rather than copying its authoring repository by default.

Inspect fixtures and expectations before freezing. After preparation, run one anchor-versus-authored calibration pass before revisions. Remove redundant cases, strengthen superficial expectations, and repair broken fixtures by discarding that run and preparing a new one; never mutate frozen evidence.

Generate the optional editable suite review only when the user asks to inspect exact cases or agent review cannot establish correctness:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" review-suite --suite "<suite-json>"
```

Freeze the run:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" prepare --target "<target-skill>" --suite "<suite-json>" --invoking-host "<claude-or-codex>" --hosts "<available-hosts>"
```

Record `run_dir`. Run calibration:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" certify --run-dir "<run-dir>" --candidate "authored" --incumbent "anchor" --label "calibration" --hosts "<available-hosts>" --judge-hosts "<available-hosts>" --repetitions 1 [--claude-model "<id>"] [--codex-model "<id>"]
```

Inspect calibration grades, analyzer notes, and artifacts. If both versions pass via the same shortcut, both fail because the fixture is broken, or expectations miss an observed outcome, discard the run and fix the suite for every arm. Otherwise continue. Persist a reusable suite only when it has durable value:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" persist-suite --run-dir "<run-dir>"
```

This writes `.skill-eval/<skill-name>/` in the target repository, never inside the distributed skill.

## 4. Optimize Behavior

If the current harness exposes `skill-creator`, resolve the directory containing its `SKILL.md` and pass it with `--skill-creator`. The engine injects those current-host instructions into each isolated revision. Otherwise it loads `references/revision.md` as the bundled evidence-driven revision contract.

Pass the invoking session's model ID for its host when known. Do not invent model IDs.

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" optimize --run-dir "<run-dir>" --hosts "<available-hosts>" --judge-hosts "<available-hosts>" --reviser-host "<invoking-host>" --repetitions 3 --max-revisions 5 [--skill-creator "<current-host-skill-creator-dir>"] [--claude-model "<id>"] [--codex-model "<id>"]
```

The command is resumable. It runs exact snapshots through both partitions, deterministic checks, anonymous transcript graders, repetition-aware blind judges, fixed-anchor and incumbent benchmarks, and sealed decisions. It hard-stops after five challengers or two non-improving passes.

For every emitted `progress` event, tell the user one short update containing the outcome, most important improvement or regression, and next adjustment. Do not narrate matrix internals. Continue automatically unless dependency/auth remediation or irreducible human judgment is required.

Objective checks govern observable facts. Anonymous graders govern unsupported transcript expectations. Blind preferences govern comparative quality. Executor self-report proves nothing. Cross-host differences are portability diagnostics, not votes.

## 5. Optimize Triggering

Only after behavior converges, optimize description discovery with three repetitions per query and host:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" optimize-description --run-dir "<run-dir>" --version "<behavior-incumbent>" --hosts "<available-hosts>" --improver-host "<invoking-host>" --repetitions 3 --max-iterations 5 [--claude-model "<id>"] [--codex-model "<id>"]
```

The improver sees training failures only. The engine selects by held-out score, records per-query stability, and limits descriptions to supported scope. Relay description progress with the same concise update rule.

If the selected version differs from the behavior incumbent, certify it against the complete frozen behavior suite:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" certify --run-dir "<run-dir>" --candidate "<description-winner>" --incumbent "<behavior-incumbent>" --label "final-description" --hosts "<available-hosts>" --judge-hosts "<available-hosts>" --repetitions 3 [--claude-model "<id>"] [--codex-model "<id>"]
```

Trigger gains never excuse a behavioral regression.

## 6. Resolve Disputes

Read the sealed benchmarks, analyzer notes, grades, judge rubrics, and raw artifacts. Generate the review page only when anonymous agents genuinely disagree on a subjective decision or the user asks:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" review --run-dir "<run-dir>"
```

The static page keeps outputs anonymous, renders inspectable artifacts, shows decision-relevant benchmark evidence, and exports structured feedback. Map a human A/B decision through the separately stored label map; never reveal labels before review.

When the user exports feedback, read `references/human-review.md` and follow it. Human feedback adjudicates only the matching anonymous comparisons; it never edits an existing benchmark or waives objective gates.

## 7. Report And Promote

Report only artifact-supported measurements: critical gates, training and held-out pass-rate statistics, standard deviation and stability, blind preference agreement, trigger precision/recall/false-trigger rate, duration, tokens, cost, tool calls/errors, and skill-byte delta when available. State the net benefit and remaining weak signals; use `unavailable` instead of invented precision.

Promotion requires the `decision_id` returned by the final accepted behavior certification:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" promote --run-dir "<run-dir>" --decision "<decision-id>" [--policy-allows-commit]
```

The engine revalidates decision, benchmark, version, suite, fixture, and authored-target hashes. It applies only the sealed winner, backs up the original, leaves dirty/untracked/protected-branch or policy-restricted work uncommitted, creates at most one final commit when allowed, and never pushes. Report the final diff or commit, run artifact path, measured benefit, coverage limitations, and remaining weak signals.
