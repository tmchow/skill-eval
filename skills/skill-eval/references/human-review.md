# Human Review Resolution

Use this only after the anonymous review page exports `skill-eval-feedback.json`.

1. Ingest the complete feedback under a fresh immutable ID:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" ingest-feedback --run-dir "<run-dir>" --feedback "<skill-eval-feedback.json>" --feedback-id "<fresh-feedback-id>"
```

2. Rebuild each affected anchor or incumbent benchmark with the same left/right versions and execution attempt IDs, but a fresh comparison ID. The engine counts only feedback whose original anonymous comparison used that exact version pair and those attempts.

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" benchmark --run-dir "<run-dir>" --left "<left-version>" --right "<winner>" --attempts "<training-attempt>,<holdout-attempt>" --comparison-id "<fresh-reviewed-comparison-id>"
```

3. Run `decide` with the fresh reviewed anchor benchmark and, when the winner has a non-anchor parent, a fresh reviewed incumbent benchmark. Promotion still requires all objective, coverage, critical, holdout, and hash gates.

Never edit or replace the pre-review benchmark. If feedback is incomplete, mismatched, or still leaves a material dispute, do not seal a decision.
