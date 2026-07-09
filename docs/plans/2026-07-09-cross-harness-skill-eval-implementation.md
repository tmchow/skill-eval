# Cross-Harness Skill Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an installable `skill-eval` plugin whose single skill can prepare, execute, judge, iterate, and safely promote skill revisions across Claude Code and Codex without installing the target skill.

**Architecture:** Keep the orchestration and qualitative judgment in `SKILL.md`, while a zero-runtime-dependency Bun/TypeScript engine owns reproducible snapshots, fixtures, host processes, deterministic checks, metrics, and promotion. Both hosts use the same skill bytes and run manifests; host adapters translate only process invocation and event parsing.

**Tech Stack:** Bun 1.2+, TypeScript, Bun test, Git, Claude Code CLI, Codex CLI, static HTML.

## Global Constraints

- Support macOS, Linux, and WSL; native Windows is out of scope.
- Require Bun 1.2 or newer and Git; use no third-party runtime packages.
- Run the exact same target skill bytes on every available host.
- Never require the target skill to be installed in the user's real host configuration.
- Treat Claude and Codex as best-effort peers: one unavailable secondary host degrades coverage but does not block a valid result.
- Keep generated evals outside the target skill; persist only calibrated suites under `.skill-eval/<skill-name>/` in the target repository.
- Limit automatic optimization to five challenger revisions and never expose held-out cases to the reviser.
- Never push, never commit intermediate revisions, and mutate the authored target only during final promotion.
- Open the review UI only for unresolved human judgment or an explicit request.

---

### Task 1: Repository And Plugin Contracts

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `.codex-plugin/plugin.json`
- Create: `.agents/plugins/marketplace.json`
- Create: `tests/plugin-contract.test.ts`

**Interfaces:**
- Consumes: the approved distribution layout in the design spec.
- Produces: `bun test`, `bun run typecheck`, and valid Claude/Codex marketplace roots that expose `./skills/`.

- [x] **Step 1: Write the failing plugin-contract test**

Create a Bun test that reads all four manifests, requires `name: "skill-eval"`, verifies both plugin manifests point at or conventionally expose `skills/`, and verifies each marketplace resolves this repository as its plugin source.

- [x] **Step 2: Run the contract test and verify RED**

Run: `bun test tests/plugin-contract.test.ts`

Expected: FAIL because the manifests and package scripts do not exist.

- [x] **Step 3: Add the minimal package and manifest files**

Use this package contract:

```json
{
  "name": "skill-eval",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit",
    "validate": "bun test && bun run typecheck"
  },
  "devDependencies": {
    "typescript": "^5.9.0"
  }
}
```

The Claude marketplace source is `./`; the Codex marketplace source is the repository URL `https://github.com/tmchow/skill-eval.git`.

- [x] **Step 4: Verify GREEN**

Run: `bun install && bun test tests/plugin-contract.test.ts`

Expected: PASS.

### Task 2: Run Contracts, Preflight, And Frozen Snapshots

**Files:**
- Create: `skills/skill-eval/scripts/lib/types.ts`
- Create: `skills/skill-eval/scripts/lib/json.ts`
- Create: `skills/skill-eval/scripts/lib/skill.ts`
- Create: `skills/skill-eval/scripts/lib/preflight.ts`
- Create: `skills/skill-eval/scripts/lib/workspace.ts`
- Create: `skills/skill-eval/scripts/lib/suite.ts`
- Create: `tests/preflight.test.ts`
- Create: `tests/workspace.test.ts`
- Create: `tests/suite.test.ts`

**Interfaces:**
- Consumes: a target directory containing `SKILL.md` and an agent-authored `EvalSuite` JSON file.
- Produces: `preflight(target, options): Promise<PreflightReport>`, `validateSuite(value): EvalSuite`, and `prepareRun(options): Promise<RunState>`.

Define the central contracts exactly once in `types.ts`:

```ts
export type HostName = "claude" | "codex";
export type Severity = "critical" | "quality" | "diagnostic";
export type Purpose = "improvement" | "regression" | "restraint" | "fallback" | "trigger";

export interface EvalSuite {
  schema_version: 1;
  skill_name: string;
  hypothesis: string;
  evals: EvalCase[];
  trigger_queries?: TriggerQuery[];
}

export interface EvalCase {
  id: string;
  name: string;
  purpose: Purpose;
  severity: Severity;
  prompt: string;
  fixture?: string;
  holdout?: boolean;
  expectations: Expectation[];
}

export interface Expectation {
  id: string;
  text: string;
  severity: Severity;
  check?: DeterministicCheck;
}
```

- [x] **Step 1: Write failing validation and preflight tests**

Cover valid/invalid skill frontmatter, duplicate eval IDs, fixture traversal, missing Bun/Git/host commands through injected command probes, invoking-host failure, and secondary-host degradation.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `bun test tests/preflight.test.ts tests/suite.test.ts tests/workspace.test.ts`

Expected: FAIL because the modules do not exist.

- [x] **Step 3: Implement validation and preflight**

Preflight must return structured checks with `ready`, `degraded`, or `blocked`, include exact remediation commands, and detect `claude plugin eval` only as an optional native capability. It must not install or authenticate anything.

- [x] **Step 4: Implement frozen run preparation**

`prepareRun` creates `/tmp/skill-eval/<skill-name>/<run-id>/`, snapshots the authored skill, extracts the tracked `HEAD` version or records a no-skill anchor, freezes fixtures, records SHA-256 hashes, captures initial Git status/branch, and writes `run.json` plus `suite.json` atomically.

- [x] **Step 5: Verify GREEN**

Run: `bun test tests/preflight.test.ts tests/suite.test.ts tests/workspace.test.ts`

Expected: PASS.

### Task 3: Host Adapters And Isolated Execution

**Files:**
- Create: `skills/skill-eval/scripts/lib/process.ts`
- Create: `skills/skill-eval/scripts/lib/hosts.ts`
- Create: `skills/skill-eval/scripts/lib/executor.ts`
- Create: `tests/hosts.test.ts`
- Create: `tests/executor.test.ts`

**Interfaces:**
- Consumes: `RunState`, version IDs, host names, and frozen eval cases.
- Produces: `runMatrix(options): Promise<ExecutionRecord[]>` and host-normalized `HostResult` records with final text, JSONL path, duration, usage, exit status, and mutation detection.

```ts
export interface HostAdapter {
  name: HostName;
  authStatus(): Promise<HostReadiness>;
  execute(request: HostRequest): Promise<HostResult>;
  detectTrigger(request: TriggerRequest): Promise<TriggerResult>;
}
```

- [x] **Step 1: Write fake-host tests first**

Create temporary fake `claude` and `codex` executables that emit representative JSONL, final output, failures, and delayed output. Assert exact argv construction, event capture, usage parsing, timeout behavior, and nonzero-exit handling.

- [x] **Step 2: Run the adapter tests and verify RED**

Run: `bun test tests/hosts.test.ts tests/executor.test.ts`

Expected: FAIL because the adapters do not exist.

- [x] **Step 3: Implement process and host adapters**

Claude behavior runs use `--safe-mode`, `--disable-slash-commands`, `--no-session-persistence`, `--output-format stream-json`, and a scratch working directory. Codex behavior runs use `exec --json --ephemeral --ignore-user-config --ignore-rules --sandbox workspace-write --skip-git-repo-check`. Both receive the exact snapshot path in the executor prompt.

- [x] **Step 4: Implement matrix execution**

For every host, version, eval, and repetition, create a fresh fixture copy, place outputs under the run workspace, capture raw JSONL/stderr/final text, hash the skill before and after, and mark malformed output or mutation as failure. Run with bounded concurrency and per-process timeouts.

- [x] **Step 5: Verify GREEN**

Run: `bun test tests/hosts.test.ts tests/executor.test.ts`

Expected: PASS.

### Task 4: Mechanical Grading, Blind Judges, Triggers, And Benchmarks

**Files:**
- Create: `skills/skill-eval/scripts/lib/assertions.ts`
- Create: `skills/skill-eval/scripts/lib/judges.ts`
- Create: `skills/skill-eval/scripts/lib/triggers.ts`
- Create: `skills/skill-eval/scripts/lib/benchmark.ts`
- Create: `skills/skill-eval/references/agents/grader.md`
- Create: `skills/skill-eval/references/agents/comparator.md`
- Create: `tests/assertions.test.ts`
- Create: `tests/judges.test.ts`
- Create: `tests/benchmark.test.ts`
- Create: `tests/triggers.test.ts`

**Interfaces:**
- Consumes: execution artifacts and the same categorical expectations for both compared versions.
- Produces: `gradeExecution`, `runBlindJudges`, `runTriggerSuite`, and `buildBenchmark`, writing auditable JSON plus concise Markdown.

Deterministic checks support `file_exists`, `file_not_exists`, `file_contains`, `file_not_contains`, `json_pointer_equals`, `final_contains`, `final_not_contains`, and `exit_success`.

- [x] **Step 1: Write failing grader, judge, trigger, and benchmark tests**

Cover path containment, binary/uninspectable artifacts, burden-of-proof failures, independently randomized A/B labels, judge disagreement, host-vs-version separation, trigger precision/recall, critical-gate aggregation, and metric deltas.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `bun test tests/assertions.test.ts tests/judges.test.ts tests/triggers.test.ts tests/benchmark.test.ts`

Expected: FAIL because the modules do not exist.

- [x] **Step 3: Implement deterministic grading and blind comparison**

Never pass version or executor identity to judges. Give each available judge the same prompt, rubric, and copied A/B artifact trees; persist the secret label map separately. Treat cross-host output differences as diagnostics, not promotion votes.

- [x] **Step 4: Implement temporary discovery tests**

Claude uses an ephemeral `--plugin-dir`; Codex uses an isolated temporary `CODEX_HOME` containing only copied authentication state and the target skill. Submit raw prompts and detect target-skill loading from the event stream. Never write to the user's installed skill directories.

- [x] **Step 5: Implement benchmark aggregation**

Report critical pass/fail, pass-rate deltas, judge preferences/agreement, false-trigger rate, duration, known token usage, tool calls when observable, and skill-byte deltas. Use `null` for unavailable metrics and never synthesize precision.

- [x] **Step 6: Verify GREEN**

Run: `bun test tests/assertions.test.ts tests/judges.test.ts tests/triggers.test.ts tests/benchmark.test.ts`

Expected: PASS.

### Task 5: CLI, Promotion, Review UI, And Runtime Skill

**Files:**
- Create: `skills/skill-eval/scripts/lib/promotion.ts`
- Create: `skills/skill-eval/scripts/lib/review.ts`
- Create: `skills/skill-eval/scripts/skill-eval.ts`
- Create: `skills/skill-eval/SKILL.md`
- Create: `skills/skill-eval/agents/openai.yaml`
- Create: `skills/skill-eval/references/eval-design.md`
- Create: `skills/skill-eval/references/schemas.md`
- Create: `skills/skill-eval/references/revision.md`
- Create: `skills/skill-eval/references/hosts.md`
- Create: `tests/cli.test.ts`
- Create: `tests/promotion.test.ts`
- Create: `tests/skill-contract.test.ts`

**Interfaces:**
- Consumes: agent-authored suite JSON and challenger skill directories.
- Produces: CLI commands `preflight`, `prepare`, `add-version`, `run`, `judge`, `trigger`, `benchmark`, `persist-suite`, `review`, and `promote`; plus one portable runtime workflow.

- [x] **Step 1: Write failing CLI, promotion, and skill-contract tests**

Assert command help/JSON output, unknown-option failure, add-version snapshots, no intermediate target mutation, dirty-vs-clean promotion, default/protected branch refusal, no push invocation, held-out wording, five-iteration limit, confirmation gate, succinct updates, and `skill-creator` delegation with fallback.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `bun test tests/cli.test.ts tests/promotion.test.ts tests/skill-contract.test.ts`

Expected: FAIL because the CLI and skill do not exist.

- [x] **Step 3: Implement the CLI and safe promotion**

Every command emits machine-readable JSON. Promotion verifies version hashes, backs up the authored target, replaces only that directory, commits only when the captured repository state was clean/tracked, the branch is neither default nor protected, and the orchestrator passes `--policy-allows-commit`; it never pushes.

- [x] **Step 4: Implement the focused static review UI**

Generate one standalone HTML file showing only disputed cases, artifact links, judge reasoning, and the exact decision requested. Do not open it automatically.

- [x] **Step 5: Write the runtime skill and references**

Keep the confirmation gate, preflight, impact map, eval calibration, automatic five-pass loop, description phase, final regression run, measurement, and promotion routing inline where they must fire. Put schemas, host details, revision prompts, and deep eval-design guidance in references. Require the current host's `skill-creator` for challengers when available; use `references/revision.md` otherwise.

- [x] **Step 6: Verify GREEN**

Run: `bun test tests/cli.test.ts tests/promotion.test.ts tests/skill-contract.test.ts`

Expected: PASS.

### Task 6: Documentation, Validation, And Live Smoke Coverage

**Files:**
- Modify: `README.md`
- Create: `NOTICE`
- Create: `.github/workflows/ci.yml`
- Create: `tests/live-smoke.test.ts`

**Interfaces:**
- Consumes: the completed CLI and plugin surfaces.
- Produces: install/use documentation, attribution, deterministic CI, and opt-in live checks.

- [x] **Step 1: Write the opt-in live smoke contract**

Skip unless `SKILL_EVAL_LIVE=1`. When enabled, create a harmless temporary skill and fixture, run one Claude and one Codex behavior case without installing the target, and assert both produce inspectable run artifacts.

- [x] **Step 2: Update README, NOTICE, and CI**

Document marketplace installation for both hosts, the confirmation-first flow, artifact locations, best-effort cross-host semantics, remediation behavior, and the absence of automatic pushes. Credit Anthropic's skill-creator evaluation methodology as inspiration and state that this is a clean-room implementation.

- [x] **Step 3: Validate skill and plugin packages**

Run:

```bash
python3 "/Users/tmchow/Library/Application Support/orca/codex-runtime-home/home/skills/.system/skill-creator/scripts/quick_validate.py" skills/skill-eval
claude plugin validate --strict .
bun run validate
```

Expected: every command exits 0.

- [x] **Step 4: Run a local fake-harness end-to-end smoke**

Run the CLI through preflight, prepare, matrix, grade, judge, benchmark, and review generation using test doubles. Confirm source hashes remain unchanged and the benchmark identifies the better fixture output.

- [x] **Step 5: Review the final diff and commit**

Run: `git diff --check && git status --short && git diff --stat`

Commit the implementation only after all deterministic checks pass.
