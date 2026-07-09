export type HostName = "claude" | "codex";
export type Severity = "critical" | "quality" | "diagnostic";
export type Purpose = "improvement" | "regression" | "restraint" | "fallback" | "trigger";
export type CheckStatus = "ready" | "degraded" | "blocked";
export type EvidencePartition = "training" | "holdout";

export type DeterministicCheck =
  | { type: "file_exists"; path: string }
  | { type: "file_not_exists"; path: string }
  | { type: "file_contains"; path: string; value: string; regex?: boolean }
  | { type: "file_not_contains"; path: string; value: string; regex?: boolean }
  | { type: "json_pointer_equals"; path: string; pointer: string; value: unknown }
  | { type: "final_contains"; value: string; regex?: boolean }
  | { type: "final_not_contains"; value: string; regex?: boolean }
  | { type: "exit_success" };

export interface Expectation {
  id: string;
  text: string;
  severity: Severity;
  check?: DeterministicCheck;
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

export interface TriggerQuery {
  id: string;
  query: string;
  should_trigger: boolean;
  holdout?: boolean;
}

export interface EvalSuite {
  schema_version: 1;
  skill_name: string;
  hypothesis: string;
  evals: EvalCase[];
  trigger_queries?: TriggerQuery[];
}

export interface ProbeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandProbe = (command: string, args: string[]) => Promise<ProbeResult>;

export interface PreflightCheck {
  id: string;
  status: CheckStatus;
  message: string;
  remediation?: string;
}

export interface HostReadiness {
  installed: boolean;
  authenticated: boolean;
  ready: boolean;
  version: string | null;
  remediation?: string;
  capabilities: Record<string, boolean>;
}

export interface PreflightReport {
  ready: boolean;
  coverage: "full" | "degraded" | "blocked";
  invoking_host: HostName;
  target_path: string;
  skill_name: string | null;
  hosts: Record<HostName, HostReadiness>;
  checks: PreflightCheck[];
  blocked: PreflightCheck[];
  degraded: PreflightCheck[];
}

export interface RunState {
  schema_version: 1;
  run_id: string;
  run_dir: string;
  created_at: string;
  target_path: string;
  repo_root: string;
  skill_name: string;
  invoking_host: HostName;
  requested_hosts: HostName[];
  host_metadata?: Partial<Record<HostName, { version: string | null }>>;
  anchor: { kind: "git"; ref: string } | { kind: "none" };
  versions: Record<string, { path: string; parent: string | null; created_at: string }>;
  hashes: {
    versions: Record<string, string | null>;
    fixtures: Record<string, string>;
    suite: string;
  };
  git: {
    initial_clean: boolean;
    initial_status: string;
    branch: string | null;
    head: string | null;
    target_tracked: boolean;
  };
}

export interface PrepareRunOptions {
  targetPath: string;
  suitePath: string;
  hosts: HostName[];
  invokingHost: HostName;
  runRoot?: string;
  runId?: string;
}

export interface HostRequest {
  cwd: string;
  prompt: string;
  eventPath: string;
  stderrPath: string;
  finalPath: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  outputSchemaPath?: string;
  model?: string;
}

export interface HostResult {
  host: HostName;
  exit_code: number;
  timed_out: boolean;
  malformed_events: number;
  final_text: string;
  duration_ms: number;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
    cost_usd: number | null;
  };
  event_path: string;
  stderr_path: string;
  final_path: string;
  command?: string;
  args?: string[];
  model?: string | null;
  metrics?: { tool_calls: number; steps: number; errors: number };
}

export interface HostAdapter {
  name: HostName;
  execute(request: HostRequest): Promise<HostResult>;
}

export interface ExecutionRecord {
  schema_version: 1;
  attempt_id: string;
  partition: EvidencePartition;
  created_at: string;
  host: HostName;
  eval_id: string;
  version: string;
  repetition: number;
  run_dir: string;
  output_dir: string;
  skill_path: string | null;
  skill_hash_before: string | null;
  skill_hash_after: string | null;
  source_mutated: boolean;
  host_result: HostResult;
}

export interface GradedExpectation {
  id: string;
  text: string;
  severity: Severity;
  passed: boolean | null;
  blocked: boolean;
  evidence: string;
}

export interface GradingResult {
  schema_version: 1;
  attempt_id?: string;
  partition?: EvidencePartition;
  host: HostName;
  eval_id: string;
  version: string;
  repetition: number;
  expectations: GradedExpectation[];
  summary: {
    passed: number;
    failed: number;
    blocked: number;
    qualitative: number;
    total: number;
    pass_rate: number | null;
    critical_failed: number;
    critical_blocked: number;
    run_failed?: boolean;
  };
}

export interface MetricStats {
  count: number;
  mean: number | null;
  stddev: number | null;
  min: number | null;
  max: number | null;
}

export interface BenchmarkArtifact {
  schema_version: 1;
  comparison_id: string;
  created_at: string;
  comparison: { left: string; right: string };
  attempt_ids: string[];
  partitions: Record<string, any>;
  preferences: { left: number; right: number; tie: number; human_left?: number; human_right?: number; human_tie?: number };
  gates: { passed: boolean; reasons: string[] };
  verdict: "improvement demonstrated" | "no regression found" | "no demonstrated improvement" | "critical regression" | "blocked or limited signal";
  notes?: string[];
  evidence_hash: string;
}

export interface DecisionArtifact {
  schema_version: 1;
  decision_id: string;
  created_at: string;
  winner: string;
  winner_hash: string;
  anchor_benchmark_id: string;
  incumbent_benchmark_id: string | null;
  approved: boolean;
  reasons: string[];
  benchmark_hashes: Record<string, string>;
  decision_hash: string;
}

export interface JudgeResult {
  schema_version: 1;
  comparison_id: string;
  execution_attempt_id: string;
  repetition: number;
  eval_id: string;
  executor_host: HostName;
  judge_host: HostName;
  left_version: string;
  right_version: string;
  labels: { A: string; B: string };
  winner_label: "A" | "B" | "TIE";
  preferred_version: string | "TIE";
  reasoning: string;
  rubric?: Record<string, unknown>;
  strengths?: Record<string, string[]>;
  weaknesses?: Record<string, string[]>;
  valid: boolean;
  run_dir: string;
}

export interface ModelGradingResult {
  schema_version: 1;
  grading_id: string;
  execution_attempt_id: string;
  partition: EvidencePartition;
  executor_host: HostName;
  grader_host: HostName;
  eval_id: string;
  version: string;
  repetition: number;
  expectations: Array<{ id: string; severity: Severity; status: "PASS" | "FAIL" | "BLOCKED"; evidence: string }>;
  claims: Array<{ claim: string; type: "factual" | "process" | "quality"; verified: boolean; evidence: string }>;
  eval_feedback: Array<{ expectation_id?: string; issue: string }>;
  valid: boolean;
  run_dir: string;
}

export interface HumanJudgment {
  schema_version: 1;
  feedback_id: string;
  comparison_id: string;
  execution_attempt_id: string;
  eval_id: string;
  executor_host: HostName;
  repetition: number;
  winner_label: "A" | "B" | "TIE";
  preferred_version: string | "TIE";
  reason: string;
  created_at: string;
}

export interface TriggerResult {
  schema_version: 1;
  attempt_id: string;
  partition: EvidencePartition;
  created_at: string;
  host: HostName;
  version: string;
  query_id: string;
  should_trigger: boolean;
  triggered: boolean;
  repetition: number;
  duration_ms: number;
  event_path: string;
  error: string | null;
}
