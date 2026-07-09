# Host Behavior And Remediation

The engine uses direct headless adapters for comparable cross-host behavior runs. The target skill is copied into each executor arm and passed by exact path, bypassing in-session installed-skill caches.

## Claude Code

Behavior runs use safe mode, disabled slash commands, no session persistence, strict MCP configuration, stream JSON, and bypass permissions inside the disposable workspace. Nested runs remove the parent `CLAUDECODE` marker. Trigger runs load an ephemeral plugin directory and use only discovery tools so real loading can occur without installing the target.

Optional native `claude plugin eval` support is detected during preflight. Treat it as supplementary capability until it can consume the same frozen suite and artifact contract; do not silently substitute a non-comparable native run.

Remediation:

- Install: `npm install -g @anthropic-ai/claude-code`
- Authenticate: `claude auth login`
- Inspect: `claude auth status`

## Codex

Behavior runs use ephemeral `codex exec`, ignored user configuration/rules, workspace-write sandboxing, JSONL, and the exact skill snapshot path. Trigger runs create a temporary `CODEX_HOME` containing only copied authentication state and the target skill. They never write to real installed skill directories.

When the invoking session model is known, pass it explicitly so the recorded execution matches user experience. The engine stores effective arguments, model IDs, host versions, tokens, cost, tool calls, steps, errors, and raw events. Omit unknown model IDs rather than guessing.

Before persistence, both host adapters redact common credential formats and values from secret-bearing environment variables in events, stderr, and final outputs. Do not place credentials in fixtures or prompts; redaction is a last boundary, not permission to expose secrets to executors.

Remediation:

- Install: `npm install -g @openai/codex`
- Authenticate: `codex login`
- Inspect: `codex login status`

## Failure Interpretation

- Missing invoking host: block before executor calls.
- Missing secondary host: degrade coverage and continue.
- Authentication failure: offer the exact login command and wait for approval.
- Malformed JSONL or timeout: fail that run; never treat absent output as a pass.
- Missing artifact inspector: block the affected expectation.
- Network or live credentials required by a fixture: obtain explicit scenario approval before enabling them.
