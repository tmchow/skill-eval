import type { BenchmarkArtifact } from "./types.ts";

export function analyzeBenchmark(benchmark: BenchmarkArtifact): string[] {
  const notes: string[] = [];
  for (const [partition, data] of Object.entries(benchmark.partitions)) {
    const versions = (data as any).versions;
    const left = versions[benchmark.comparison.left];
    const right = versions[benchmark.comparison.right];
    const delta = (data as any).delta;
    if (delta.pass_rate === 0) notes.push(`${partition}: aggregate pass rate is non-discriminating between versions.`);
    if ((right.pass_rate.stddev ?? 0) >= 0.2 || (left.pass_rate.stddev ?? 0) >= 0.2) notes.push(`${partition}: pass rate is highly variable; inspect repeated cases before promotion.`);
    if ((delta.cost_usd ?? 0) > 0.01) notes.push(`${partition}: candidate cost increased by ${delta.cost_usd.toFixed(4)} USD per run on average.`);
    if ((delta.total_tokens ?? 0) > 0) notes.push(`${partition}: candidate token use increased by ${Math.round(delta.total_tokens)} on average.`);
    if ((delta.duration_ms ?? 0) > 0) notes.push(`${partition}: candidate duration increased by ${Math.round(delta.duration_ms)} ms on average.`);
  }
  return notes;
}
