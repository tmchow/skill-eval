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

Fixture paths are relative to the suite file and may not escape that directory. Behavior cases require at least one expectation. Promotion requires at least one training and held-out behavior case. Description optimization requires positive and negative trigger coverage across both partitions.

## Deterministic Checks

- `{"type":"file_exists","path":"result.csv"}`
- `{"type":"file_not_exists","path":"unsafe.txt"}`
- `{"type":"file_contains","path":"result.txt","value":"ready","regex":false}`
- `{"type":"file_not_contains","path":"result.txt","value":"secret"}`
- `{"type":"json_pointer_equals","path":"result.json","pointer":"/items/0/status","value":"ready"}`
- `{"type":"final_contains","value":"completed"}`
- `{"type":"final_not_contains","value":"unsupported claim"}`
- `{"type":"exit_success"}`

Paths are relative to the executor output directory. Binary artifacts without a deterministic inspector remain qualitative rather than being guessed.

## Immutable Evidence

`run.json` records source paths, fixed anchor, Git state, host versions, version hashes, fixture hashes, and suite hash. Each behavior, trigger, grader, judge, benchmark, and decision invocation has a unique ID and immutable artifact directory. Attempt manifests record planned dimensions and completion; an interrupted or reused ID cannot be overwritten.

Indexes:

- `executions.json`: attempt, partition, host, version, case, repetition, metrics, and artifact paths.
- `gradings.json`: deterministic grades and automatic executor gates.
- `model-gradings.json`: anonymous transcript/artifact expectation grades, verified claims, and eval feedback.
- `judgments.json`: comparison and execution attempt IDs, repetition, anonymous rubric, preference, and post-exit label map.
- `human-judgments.json`: optional feedback ID, matched anonymous comparison, mapped preference, and reason.
- `triggers.json`: attempt, partition, query, host, repetition, discovery result, and timing.
- `benchmarks.json`: immutable comparisons with partition statistics, gates, analyzer notes, verdict, and evidence hash.
- `decisions/<id>.json`: approved winner, exact benchmark hashes, winner hash, and decision hash.

Complete runs live at `/tmp/skill-eval/<skill-name>/<run-id>/`. Optional calibrated suites live at `<target-repo>/.skill-eval/<skill-name>/`.

Event, stderr, and final-output artifacts redact recognized credential formats and values supplied through secret-bearing environment variables before persistence.
