export type HostName = "claude" | "codex";
export type Severity = "critical" | "quality" | "diagnostic";
export type Purpose = "improvement" | "regression" | "restraint" | "fallback" | "trigger";
export type CheckStatus = "ready" | "degraded" | "blocked";
export type EvidencePartition = "training" | "validation";
export type ClaimClass = "conformance" | "effectiveness" | "generalization";
export type ExpectationScope = "execution" | "comparison";
export type ComparisonGoal = "improve" | "not-worse";
export type VersionScope = "all" | "anchor" | "candidate";
export type EvidenceRole = "outcome" | "mechanism";
export type RuntimeRole = "behavior" | "critic" | "grader" | "judge" | "trigger";
export type RuntimeRoleGroup = "behavior" | "evaluator";

export interface HostRuntimeConfig {
  model?: string;
  reasoning_effort?: string;
}

export type HostRuntimeProfiles = Partial<Record<HostName, HostRuntimeConfig>>;
export type RuntimeRoleProfiles = Partial<Record<RuntimeRoleGroup, HostRuntimeProfiles>>;

export interface EffectiveRuntimeProfile {
  role: RuntimeRole;
  host: HostName;
  model: string;
  reasoning_effort: string;
  context_mode: "isolated" | "project-context" | "live";
  capabilities: string[];
}

export type DeterministicCheck =
  | { type: "file_exists"; path: string; root?: "output" | "workspace" }
  | { type: "file_not_exists"; path: string; root?: "output" | "workspace" }
  | { type: "file_contains"; path: string; value: string; regex?: boolean; root?: "output" | "workspace" }
  | { type: "file_not_contains"; path: string; value: string; regex?: boolean; root?: "output" | "workspace" }
  | { type: "json_pointer_equals"; path: string; pointer: string; value: unknown; root?: "output" | "workspace" }
  | { type: "final_contains"; value: string; regex?: boolean }
  | { type: "final_not_contains"; value: string; regex?: boolean }
  | { type: "tool_called"; value: string; regex?: boolean }
  | { type: "tool_not_called"; value: string; regex?: boolean }
  | { type: "tool_call_count"; value: string; count: number; regex?: boolean }
  | { type: "tool_result_contains"; tool: string; value: string; regex?: boolean }
  | { type: "interactive_prompt_not_used" }
  | { type: "exit_success" };

export interface Expectation {
  id: string;
  text: string;
  severity: Severity;
  evidence_role: EvidenceRole;
  scope?: ExpectationScope;
  comparison_goal?: ComparisonGoal;
  version_scope?: VersionScope;
  prerequisite?: boolean;
  outcome_basis?: "terminal-action";
  check?: DeterministicCheck;
}

export interface EvalCase {
  id: string;
  name: string;
  purpose: Purpose;
  severity: Severity;
  prompt: string;
  fixture?: string;
  validation?: boolean;
  expectations: Expectation[];
}

export interface TriggerQuery {
  id: string;
  query: string;
  should_trigger: boolean;
  validation?: boolean;
}

export interface EvalSuite {
  schema_version: 2;
  claim_class: ClaimClass;
  skill_name: string;
  hypothesis: string;
  environment?: {
    fidelity: "isolated" | "project-context" | "live";
    external_state: string[];
    capabilities?: Array<"git-write">;
    comparison_projection?: {
      text_redactions: Array<{ pattern: string; replacement: string }>;
      omit_tool_events?: boolean;
    };
    comparison_projection_required?: boolean;
  };
  evals: EvalCase[];
  trigger_queries?: TriggerQuery[];
}

export interface SuiteCritique {
  schema_version: 2;
  critic_host: HostName;
  verdict: "PASS" | "REVISE";
  reasoning: string;
  issues: Array<{ severity: Severity; issue: string; fix: string }>;
  valid: boolean;
  created_at: string;
  runtime_profile?: EffectiveRuntimeProfile;
}

export type CritiqueDisposition = "accepted" | "rejected" | "limitation" | "blocked";

export interface SuiteCritiqueAdjudicationInput {
  schema_version: 2;
  summary: string;
  decisions: Array<{
    critic_host: HostName;
    issue_index: number;
    disposition: CritiqueDisposition;
    rationale: string;
  }>;
}

export interface SuiteCritiqueAdjudication extends SuiteCritiqueAdjudicationInput {
  critique_hash: string;
  approved: boolean;
  created_at: string;
}

export interface InvalidatedCheck {
  schema_version: 2;
  attempt_id: string;
  eval_id: string;
  expectation_id: string;
  reason: string;
  created_at: string;
  content_hash: string;
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
  schema_version: 2;
  run_id: string;
  run_dir: string;
  created_at: string;
  target_path: string;
  repo_root: string;
  skill_name: string;
  invoking_host: HostName;
  requested_hosts: HostName[];
  host_metadata?: Partial<Record<HostName, { version: string | null }>>;
  executor_exclusions?: string[];
  campaign?: { campaign_dir: string; role: string; measurement_goal?: string };
  anchor:
    | { kind: "git"; ref: string; commit?: string }
    | { kind: "none"; ref?: string; commit?: string };
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
  anchorRef?: string;
  cwd?: string;
  runRoot?: string;
  runId?: string;
  executorExclusions?: string[];
  campaignDir?: string;
  campaignRole?: string;
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
  reasoningEffort?: string;
  role?: RuntimeRole;
  capabilities?: string[];
  contextMode?: "isolated" | "project-context" | "live";
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
  reasoning_effort?: string | null;
  runtime_profile?: EffectiveRuntimeProfile;
  metrics?: { tool_calls: number; steps: number; errors: number };
}

export interface HostAdapter {
  name: HostName;
  execute(request: HostRequest): Promise<HostResult>;
}

export interface ExecutionRecord {
  schema_version: 2;
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
  wrong_skill_source?: boolean;
  executor_exclusions?: string[];
  runtime_profile?: EffectiveRuntimeProfile;
  host_result: HostResult;
}

export interface BehaviorAttemptManifest {
  schema_version: 2;
  attempt_id: string;
  kind: "behavior";
  status: "started" | "interrupted" | "complete";
  created_at: string;
  partition: EvidencePartition | "all";
  versions: string[];
  hosts: HostName[];
  eval_ids: string[];
  repetitions: number;
  planned_records: number;
  record_count: number;
  runtime_profiles: Partial<Record<HostName, { model: string; reasoning_effort: string }>>;
  completed_at?: string;
  interrupted_at?: string;
}

export interface GradedExpectation {
  id: string;
  text: string;
  severity: Severity;
  evidence_role: EvidenceRole;
  scope?: ExpectationScope;
  comparison_goal?: ComparisonGoal;
  version_scope?: VersionScope;
  prerequisite?: boolean;
  passed: boolean | null;
  blocked: boolean;
  evidence: string;
}

export interface GradingResult {
  schema_version: 2;
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
    prerequisites_passed?: number;
    prerequisites_failed?: number;
    prerequisites_blocked?: number;
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

export interface BenchmarkVersionSummary {
  runs: number;
  successful_runs: number;
  unsuccessful_runs: number;
  timed_out_runs: number;
  pass_rate: MetricStats;
  duration_ms: MetricStats;
  total_tokens: MetricStats;
  cost_usd: MetricStats;
  tool_calls: MetricStats;
  errors: MetricStats;
  critical_failed: number;
  critical_blocked: number;
  blocked: number;
  skill_bytes: number;
  trigger: Record<string, unknown> | null;
}

export interface BenchmarkPartition {
  versions: Record<string, BenchmarkVersionSummary>;
  delta: {
    pass_rate: number | null;
    duration_ms: number | null;
    total_tokens: number | null;
    cost_usd: number | null;
    skill_bytes: number;
  };
}

export interface BenchmarkArtifact {
  schema_version: 2;
  comparison_id: string;
  created_at: string;
  comparison: { left: string; right: string };
  attempt_ids: string[];
  partitions: Partial<Record<EvidencePartition, BenchmarkPartition>>;
  preferences: { left: number; right: number; tie: number; human_left?: number; human_right?: number; human_tie?: number };
  cross_model?: {
    judge_hosts: Record<string, { left: number; right: number; tie: number }>;
    judge_votes?: { left: number; right: number; tie: number };
    independent_pairs?: { left: number; right: number; tie: number; total: number };
    agreement_cases: number;
    disagreement_cases: number;
  };
  gates: { passed: boolean; reasons: string[] };
  verdict: "improvement demonstrated" | "no regression found" | "no demonstrated improvement" | "critical regression" | "blocked or limited signal";
  notes?: string[];
  evidence_hash: string;
}

export interface EvidenceClaim {
  schema_version: 2;
  claim_id: string;
  created_at: string;
  authored_version: "authored";
  authored_hash: string;
  anchor: { kind: "git" | "none"; ref: string | null; commit: string | null; snapshot_hash: string | null };
  suite_hash: string;
  fixture_hashes: Record<string, string>;
  benchmark_id: string;
  benchmark_hash: string;
  requested_hosts: HostName[];
  completed_hosts: HostName[];
  completed_partitions: EvidencePartition[];
  verdict: "improvement demonstrated";
  environment: { fidelity: "isolated" | "project-context" | "live"; external_state: string[]; validation_visibility: "caller-visible" };
  supported: true;
  limitations: string[];
  claim_hash: string;
}

export interface JudgeResult {
  schema_version: 2;
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
  expectations?: Array<{ id: string; severity: Severity; evidence_role: EvidenceRole; goal: ComparisonGoal; status: "PASS" | "FAIL" | "BLOCKED"; evidence: string }>;
  valid: boolean;
  run_dir: string;
  runtime_profile?: EffectiveRuntimeProfile;
}

export interface ModelGradingResult {
  schema_version: 2;
  grading_id: string;
  execution_attempt_id: string;
  partition: EvidencePartition;
  executor_host: HostName;
  grader_host: HostName;
  eval_id: string;
  version: string;
  repetition: number;
  expectations: Array<{ id: string; severity: Severity; evidence_role: EvidenceRole; status: "PASS" | "FAIL" | "BLOCKED"; evidence: string }>;
  claims: Array<{ claim: string; type: "factual" | "process" | "quality"; verified: boolean; evidence: string }>;
  eval_feedback: Array<{ expectation_id?: string; issue: string }>;
  valid: boolean;
  run_dir: string;
  runtime_profile?: EffectiveRuntimeProfile;
}

export interface HumanJudgment {
  schema_version: 2;
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
  schema_version: 2;
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
  runtime_profile?: EffectiveRuntimeProfile;
}
