import { resolve } from "node:path";
import { readJson } from "./json.ts";
import { validateSuite } from "./suite.ts";
import { loadSuite } from "./workspace.ts";
import { hasBlindJudgeCriteria, hasExecutionQualitative } from "./expectations.ts";
import type { EvidencePartition, HostName } from "./types.ts";

export interface CallEstimateOptions {
  runDir?: string;
  suitePath?: string;
  workflow: "run" | "compare";
  versions: string[];
  hosts: HostName[];
  judgeHosts?: HostName[];
  criticHosts?: HostName[];
  repetitions?: number;
  partition?: EvidencePartition | "all";
}

export async function estimateCalls(options: CallEstimateOptions): Promise<Record<string, any>> {
  if (!["run", "compare"].includes(options.workflow)) throw new Error("call estimate workflow must be run or compare");
  if (!options.runDir && !options.suitePath) throw new Error("call estimate requires runDir or suitePath");
  const suite = options.runDir ? await loadSuite(resolve(options.runDir)) : validateSuite(await readJson(resolve(options.suitePath!)));
  const repetitions = options.repetitions ?? 1;
  const partition = options.partition ?? (options.workflow === "compare" ? "training" : "all");
  const cases = suite.evals.filter((item) => partition === "all" || (item.validation ? "validation" : "training") === partition);
  const hosts = [...new Set(options.hosts)];
  const versions = [...new Set(options.versions)];
  const judgeHosts = [...new Set(options.judgeHosts ?? [])];
  const criticHosts = [...new Set(options.criticHosts ?? [])];
  if (hosts.length === 0 || versions.length === 0) throw new Error("call estimate requires hosts and versions");
  if (options.workflow === "compare" && (versions.length !== 2 || judgeHosts.length === 0)) throw new Error("compare estimate requires exactly two versions and at least one judge host");
  const critics = suite.claim_class === "conformance" ? 0 : criticHosts.length;
  const behavior = cases.length * versions.length * hosts.length * repetitions;
  const executionQualitativeCells = cases.reduce((total, item) => total + versions.filter((version) => hasExecutionQualitative(item, version)).length, 0);
  const executionQualitativeCases = cases.filter((item) => versions.some((version) => hasExecutionQualitative(item, version))).length;
  const comparisonQualitativeCases = options.workflow === "compare" ? cases.filter((item) => hasBlindJudgeCriteria(item, versions[0]!, versions[1]!)).length : 0;
  const qualitativeGraders = options.workflow === "compare" ? executionQualitativeCells * hosts.length * repetitions * judgeHosts.length : 0;
  const blindJudges = options.workflow === "compare" ? comparisonQualitativeCases * hosts.length * repetitions * judgeHosts.length : 0;
  return {
    workflow: options.workflow, partition, cases: cases.length, qualitative_cases: comparisonQualitativeCases, execution_qualitative_cases: executionQualitativeCases, repetitions,
    hosts, versions, judge_hosts: judgeHosts, critic_hosts: criticHosts,
    calls: { critics, behavior, qualitative_graders: qualitativeGraders, blind_judges: blindJudges, total: critics + behavior + qualitativeGraders + blindJudges },
    excludes: ["nested model or subagent calls made by the evaluated skill", "retries after invalid or interrupted evidence"],
  };
}
