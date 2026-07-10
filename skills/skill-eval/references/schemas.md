# Suite And Artifact Schemas

## Suite

```json
{
  "schema_version": 1,
  "skill_name": "example-skill",
  "hypothesis": "The revision closes the unavailable-tool fallback without changing explicit opt-in.",
  "evals": [
    {
      "id": "unavailable-default",
      "name": "Unavailable tool defaults closed",
      "purpose": "fallback",
      "severity": "critical",
      "prompt": "Complete the task when the optional helper is unavailable.",
      "fixture": "fixtures/unavailable-default",
      "holdout": false,
      "expectations": [
        {
          "id": "no-false-success",
          "text": "The result does not claim the unavailable helper ran.",
          "severity": "critical",
          "check": { "type": "final_not_contains", "value": "helper completed" }
        }
      ]
    },
    {
      "id": "held-out-variant",
      "name": "Held-out fallback variant",
      "purpose": "fallback",
      "severity": "critical",
      "prompt": "Handle a different realistic unavailable-helper situation.",
      "holdout": true,
      "expectations": [
        { "id": "safe-result", "text": "The result fails closed with an actionable explanation.", "severity": "critical" }
      ]
    }
  ],
  "trigger_queries": [
    { "id": "positive-training", "query": "Evaluate the skill revision I just made", "should_trigger": true, "holdout": false },
    { "id": "adjacent-holdout", "query": "Evaluate this stock revision", "should_trigger": false, "holdout": true }
  ]
}
```

Fixture paths are relative to the suite file and may not escape that directory. `evals` may be empty for trigger-only evaluation, but a suite must contain at least one behavior case or trigger query. Behavior cases require at least one expectation. Promotion requires at least one training and held-out behavior case. Description optimization requires positive and negative trigger coverage across both partitions.

## Deterministic Checks

- `{"type":"file_exists","path":"result.csv"}`
- `{"type":"file_not_exists","path":"unsafe.txt"}`
- `{"type":"file_contains","path":"result.txt","value":"ready","regex":false}`
- `{"type":"file_not_contains","path":"result.txt","value":"secret"}`
- `{"type":"json_pointer_equals","path":"result.json","pointer":"/items/0/status","value":"ready"}`
- `{"type":"final_contains","value":"completed"}`
- `{"type":"final_not_contains","value":"unsupported claim"}`
- `{"type":"tool_called","value":"cross-model-review.sh"}`
- `{"type":"tool_not_called","value":"dangerous-command","regex":false}`
- `{"type":"tool_call_count","value":"adversarial-reviewer","count":1}`
- `{"type":"exit_success"}`

Paths are relative to the executor output directory. Tool-call checks inspect structured invocation records in the host JSONL, not prompt or result text. Binary artifacts without a deterministic inspector remain qualitative rather than being guessed.

## Immutable Evidence

`run.json` records source paths, fixed anchor, Git state, host versions, version hashes, fixture hashes, and suite hash. Each behavior, trigger, grader, judge, benchmark, and decision invocation has a unique ID and immutable artifact directory. Attempt manifests record planned dimensions and progress. A complete attempt is immutable; a started behavior attempt may resume only when its original dimensions still match, and only missing runs execute.

Indexes:

- `executions.json`: incrementally persisted attempt, partition, host, version, case, repetition, metrics, and artifact paths.
- `gradings.json`: deterministic grades and automatic executor gates, persisted as each behavior run completes.
- `model-gradings.json`: anonymous transcript/artifact expectation grades, verified claims, and eval feedback.
- `judgments.json`: comparison and execution attempt IDs, repetition, anonymous rubric, preference, and post-exit label map.
- `human-judgments.json`: optional feedback ID, matched anonymous comparison, mapped preference, and reason.
- `script-checks.json`: immutable model-free checks of bundled scripts, including version, arguments, output paths, timeout, mutation guard, and pass status.
- `triggers.json`: attempt, partition, query, host, repetition, discovery result, and timing.
- `benchmarks.json`: immutable comparisons with partition statistics, gates, analyzer notes, verdict, and evidence hash.
- `decisions/<id>.json`: approved winner, exact benchmark hashes, winner hash, and decision hash.

Complete runs live at `/tmp/skill-eval/<skill-name>/<run-id>/`. Optional calibrated suites live at `<target-repo>/.skill-eval/<skill-name>/`.

Event, stderr, and final-output artifacts redact recognized credential formats and values supplied through secret-bearing environment variables before persistence.

`compare` builds a training-only benchmark for evaluation and calibration; it cannot produce a decision. `certify` requires complete training and held-out evidence before its first model call and is the only behavior path that seals a promotable decision.

`run.json.executor_exclusions` lists confirmed evaluator-only files omitted from executor and script-check copies. The full frozen versions retain those files and their hashes; `SKILL.md` and referenced runtime material cannot be excluded through the evaluator-file path.

## Campaign Checkpoint

A campaign links the separate immutable runs used for one measurement goal. Deterministic commands assemble factual run context; the evaluating agent supplies each reasoning checkpoint and authors the final report.

```json
{
  "stage": "calibration",
  "summary": "The current version improved review usefulness, but one judge treated added caveats as noise.",
  "established": ["Current won 3 of 4 blind comparisons on the improvement case."],
  "cross_model": ["Claude preferred current in both repetitions; Codex split 1-1 on concision."],
  "limitations": ["Behavior execution covered Claude only."],
  "next_adjustment": "Tighten caveat prioritization without removing supported findings.",
  "evidence_run_ids": ["2026-07-10T18-00-00-000Z-abcd1234"]
}
```

`stage`, `summary`, and every array entry are non-empty strings. `next_adjustment` is a non-empty string or `null`. Every evidence run must already belong to the campaign. Checkpoints are append-only and hash-verified when campaign context is read.
