# Human Review Resolution

Use this only for subjective cases that anonymous agents cannot resolve or when the user explicitly asks to inspect a comparison.

## Display The Review

Use a stable OS-temp display root for the run. Start the bundled display-only server first so it creates the screen directory and remains available while the harness waits for user input:

```bash
SKILL_DIR="<absolute path of this skill directory>"; DISPLAY_ROOT="/tmp/skill-eval/review/<run-id>"; bun "$SKILL_DIR/scripts/review-server.js" start --root "$DISPLAY_ROOT"
```

Generate the current review into that server's screen directory:

```bash
SKILL_DIR="<absolute path of this skill directory>"; DISPLAY_ROOT="/tmp/skill-eval/review/<run-id>"; bun "$SKILL_DIR/scripts/skill-eval.ts" review --run-dir "<run-dir>" --output "$DISPLAY_ROOT/screens/001-review.html"
```

The server returns one localhost URL. Prefer the current harness's built-in browser when it can navigate local URLs. Otherwise open the URL in the system browser or give it to the user. If detached processes are reaped, start again with `--foreground` through the harness's long-running terminal capability. If localhost is unreachable, open the generated HTML directly; do not add cloud hosting or a browser event channel.

The page is display-only. It may refresh when a newer review screen appears, but it never captures clicks, form state, analytics, or decisions. Version identity remains hidden.

## Collect And Record The Decision

The `review` command returns safe descriptors containing `case_id`, case context, and anonymous model votes. For each descriptor, use the current harness's native blocking question capability when available; otherwise ask in chat. Let the case determine the wording. Collect `A`, `B`, or `TIE`, and ask for rationale or clarification only when the answer alone does not resolve the dispute. Handle multiple unresolved cases one at a time.

Record the user's authoritative response directly. The agent, not the user, converts it into evaluation state:

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" record-feedback --run-dir "<run-dir>" --case-id "<case-id>" --winner "<A-or-B-or-TIE>" [--reason "<reason>"]
```

Each review case accepts one immutable human decision. The command maps the anonymous label through the separately stored label map only after the user answers.

After all decisions are recorded, stop the display server:

```bash
SKILL_DIR="<absolute path of this skill directory>"; DISPLAY_ROOT="/tmp/skill-eval/review/<run-id>"; bun "$SKILL_DIR/scripts/review-server.js" stop --root "$DISPLAY_ROOT"
```

## Rebuild Evidence

Rebuild each affected anchor or incumbent benchmark with the same left/right versions and execution attempt IDs, but a fresh comparison ID. The engine counts only feedback matching the original anonymous comparison and attempts.

```bash
SKILL_DIR="<absolute path of this skill directory>"; bun "$SKILL_DIR/scripts/skill-eval.ts" benchmark --run-dir "<run-dir>" --left "<left-version>" --right "<winner>" --attempts "<training-attempt>,<holdout-attempt>" --comparison-id "<fresh-reviewed-comparison-id>"
```

Run `decide` with the fresh reviewed anchor benchmark and, when the winner has a non-anchor parent, a fresh reviewed incumbent benchmark. Human judgment never edits a pre-review benchmark or waives objective, critical, coverage, holdout, or hash gates. If the response remains ambiguous, do not seal a decision.
