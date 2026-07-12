# Suite And Artifact Schemas

## Suite

```json
{
  "schema_version": 2,
  "claim_class": "generalization",
  "skill_name": "example-skill",
  "hypothesis": "The current skill produces a more useful review without adding unsupported findings.",
  "environment": {
    "fidelity": "isolated",
    "external_state": [],
    "comparison_projection_required": true,
    "comparison_projection": {
      "text_redactions": [
        { "pattern": "-(?:claude|codex)\\b", "replacement": "" }
      ],
      "omit_tool_events": true
    }
  },
  "evals": [
    {
      "id": "review-quality",
      "name": "Useful review",
      "purpose": "improvement",
      "severity": "critical",
      "prompt": "Review this plan for material risks.",
      "fixture": "fixtures/review-quality",
      "expectations": [
        {
          "id": "peer-completed",
          "text": "The required peer review completed.",
          "severity": "critical",
          "evidence_role": "mechanism",
          "version_scope": "candidate",
          "prerequisite": true,
          "check": { "type": "tool_result_contains", "tool": "cross-model-review.sh", "value": "complete" }
        },
        {
          "id": "review-improves",
          "text": "The current review identifies more material issues without adding unsupported claims.",
          "severity": "critical",
          "evidence_role": "outcome",
          "scope": "comparison",
          "comparison_goal": "improve"
        }
      ]
    },
    {
      "id": "validation-review",
      "name": "Different realistic review",
      "purpose": "regression",
      "severity": "quality",
      "prompt": "Review this different plan for material risks.",
      "fixture": "fixtures/validation-review",
      "validation": true,
      "expectations": [
        {
          "id": "review-not-worse",
          "text": "The current review is no less useful or accurate.",
          "severity": "quality",
          "evidence_role": "outcome",
          "scope": "comparison",
          "comparison_goal": "not-worse"
        }
      ]
    }
  ],
  "trigger_queries": [
    { "id": "positive-training", "query": "Evaluate the skill revision I just made", "should_trigger": true },
    { "id": "adjacent-validation", "query": "Evaluate this stock revision", "should_trigger": false, "validation": true }
  ]
}
```

`schema_version` is `2`. `claim_class` is `conformance`, `effectiveness`, or `generalization`. Effectiveness requires a paired anchor, including a no-skill anchor for a new skill. Generalization requires outcome evidence in both training and validation. A suite must contain at least one behavior case or trigger query, and every behavior case needs an expectation.

Every expectation requires `evidence_role: "outcome" | "mechanism"`:

- Outcome expectations alone contribute positive pass-rate, model-grade, blind-preference, and effectiveness evidence.
- Mechanism expectations establish causal support. A failed critical mechanism can gate the claim; a passing mechanism cannot improve the comparative score.
- `prerequisite: true` is allowed only on a critical deterministic mechanism expectation.

Qualitative expectations accept `scope: "execution" | "comparison"`, defaulting to `execution`. Comparison scope requires `comparison_goal: "improve" | "not-worse"` and is judged only from anonymous pairs. Deterministic checks cannot use comparison scope.

Mechanism execution expectations accept `version_scope: "all" | "anchor" | "candidate"`, defaulting to `all`; `candidate` means any non-anchor snapshot. Outcome evidence must apply to all versions so arm-specific checks cannot manufacture comparative improvement. Comparison expectations cannot use version scope.

Fixture paths are relative to the suite file and cannot escape it. `environment.fidelity` is `isolated`, `project-context`, or `live`; list unfrozen dependencies in `external_state`. `git-write` is the only current capability and requires isolated fixture-backed cases.

`environment.comparison_projection` sanitizes only anonymous judge packages. Apply redactions symmetrically and never remove substantive findings, recommendations, errors, or quality differences. Arm-scoped objective diagnostics are always withheld from blind packages. Set `comparison_projection_required: true` when treatment metadata would otherwise reveal the current arm; validation rejects the suite if no projection is supplied.

## Deterministic Checks

- `{"type":"file_exists","path":"result.csv"}`
- `{"type":"file_not_exists","path":"unsafe.txt"}`
- `{"type":"file_contains","path":"result.txt","value":"ready","regex":false}`
- `{"type":"file_contains","root":"workspace","path":"src/result.txt","value":"ready"}`
- `{"type":"file_not_contains","path":"result.txt","value":"secret"}`
- `{"type":"json_pointer_equals","path":"result.json","pointer":"/items/0/status","value":"ready"}`
- `{"type":"final_contains","value":"completed"}`
- `{"type":"final_not_contains","value":"unsupported claim"}`
- `{"type":"tool_called","value":"cross-model-review.sh"}`
- `{"type":"tool_not_called","value":"dangerous-command","regex":false}`
- `{"type":"tool_call_count","value":"adversarial-reviewer","count":1}`
- `{"type":"tool_result_contains","tool":"cross-model-review.sh","value":"complete"}`
- `{"type":"exit_success"}`

Paths default to `outputs/`; use `root: "workspace"` for fixture-repository files. Tool checks inspect structured host events, not prompt text. `tool_result_contains` proves usable completion, while `tool_called` proves launch only. Final-output substring checks prove literal wording, not semantic intent.

## Critique Adjudication

```json
{
  "schema_version": 2,
  "summary": "One fixture flaw is accepted; one provenance request is outside the confirmed outcome.",
  "decisions": [
    { "critic_host": "claude", "issue_index": 0, "disposition": "accepted", "rationale": "The fixture cannot activate the claimed behavior." },
    { "critic_host": "codex", "issue_index": 0, "disposition": "rejected", "rationale": "The confirmed hypothesis concerns delivered quality, not sentence provenance." }
  ]
}
```

Every latest valid critique issue appears exactly once. Dispositions are `accepted`, `rejected`, `limitation`, or `blocked`. A critical issue cannot be waived as a limitation. A later critique invalidates the prior adjudication hash.

## Evidence Artifacts

`run.json` binds source paths, fixed anchor, Git state, requested hosts, hashes, exclusions, and campaign. Model-backed records include effective role, host, model, reasoning effort, context mode, and capability scope. Distinct behavior and evaluator runtime profiles prevent ceiling-model judgment from masquerading as behavior portability.

- `executions.json`: host, version, case, partition, repetition, metrics, status, and artifact paths.
- `gradings.json`: deterministic outcome/mechanism grades and executor gates.
- `model-gradings.json`: anonymous single-output outcome grades and verified claims.
- `judgments.json`: anonymous paired criteria, overall preference, pair identity, and post-exit label map.
- `human-judgments.json`: optional native-harness adjudication of one anonymous pair.
- `invalidated-checks.json`: semantically broken checks; matching evidence is blocked.
- `script-checks.json`: immutable model-free mechanism checks.
- `triggers.json`: partition, query, host, repetition, discovery result, and runtime profile.
- `benchmarks.json`: partition statistics, pair preferences, gates, verdict, and evidence hash.
- `artifacts/evidence-index.json`: deterministic factual index with source hashes, coverage, failures, and missing hosts. It contains no diagnosis or advice.
- `claims/<id>.json`: hash-bound confirmation claim over the fixed anchor, current snapshot, both partitions, required hosts, and benchmark.

`compare` runs training calibration and cannot seal a claim. `confirm` requires a generalization suite, both partitions, the exact prepared host scope, and passing outcome evidence. It seals a claim but never mutates the target.

Complete runs live at `/tmp/skill-eval/<skill-name>/<run-id>/`. Optional reusable suites live at `<target-repo>/.skill-eval/<skill-name>/`. Event, stderr, and final-output artifacts redact recognized credentials before persistence.

## Campaign Records

A campaign pins one target, measurement goal, and fixed anchor across runs. Each run link records suite hash, case and trigger IDs, role, and validation visibility. Later suites cannot silently drop prior cases or triggers. A case retirement requires matching `invalidated-check` evidence and records its own hash.

An agent-authored checkpoint contains `stage`, `summary`, `established`, `cross_model`, `limitations`, `next_adjustment`, and `evidence_run_ids`. Checkpoints are append-only reasoning aids, not objective evidence. `campaign-context` combines them with factual indexes so an agent can reconstruct the evaluation after context compaction and re-open raw evidence for material claims.
