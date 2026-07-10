# Host Behavior And Remediation

The engine uses direct headless adapters for comparable cross-host behavior runs. The target skill is copied into each executor arm and passed by exact path, bypassing in-session installed-skill caches.

## Long-Running Engine Commands

Launch `compare`, `certify`, and `optimize` through the invoking host's native background or persistent-command primitive, then use `status --run-dir <run-dir>` for cheap progress reads. Keep the Bun process attached to the host-managed job so completion and exit status remain observable. Do not wrap a host-managed background command in `nohup`, `setsid`, an extra `&`, or another detach layer; the wrapper can report completion while the real evaluation is still running.

- **Claude Code:** use background Bash and its native output/monitor capability. Do not hold the command in foreground Bash, whose ceiling may be shorter than a multi-run evaluation.
- **Codex:** keep the command in the persistent exec session and poll that session with the harness's native wait/write capability. The evaluated `codex exec --ephemeral` children are intentionally isolated; they do not prevent the outer Bun job from remaining attached.

If the invoking harness offers neither capability, use its documented job mechanism rather than improvising shell detachment. The engine's durable manifests and arm-level resume are the recovery contract, not a daemon.

## Claude Code

Behavior runs use safe mode, disabled slash commands, no session persistence, strict MCP configuration, stream JSON, and bypass permissions inside the disposable workspace. Safe mode and disabled skills mean same-name installed skills cannot participate; the executor reads only the exact frozen path in its prompt. Nested runs remove the inherited parent `CLAUDECODE` marker so another Claude process can start; that child re-establishes `CLAUDECODE=1` for its own tool subprocesses, so skill host detection still works. This was verified with a live nested shell probe. Trigger runs load an ephemeral plugin directory and use only discovery tools so real loading can occur without installing the target.

Optional native `claude plugin eval` support is detected during preflight. Treat it as supplementary capability until it can consume the same frozen suite and artifact contract; do not silently substitute a non-comparable native run.

Remediation:

- Install: `npm install -g @anthropic-ai/claude-code`
- Authenticate: `claude auth login`
- Inspect: `claude auth status`

## Codex

Behavior runs use ephemeral `codex exec`, ignored user configuration/rules, an auth-only temporary `CODEX_HOME`, workspace-write sandboxing, JSONL, and the exact skill snapshot path. Claude runs disable customizations and settings, use native automatic permissions, and do not bypass permission checks. No user-installed skills are copied. Trigger runs add only the frozen target skill to another temporary home. They never read or write real installed skill directories.

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
