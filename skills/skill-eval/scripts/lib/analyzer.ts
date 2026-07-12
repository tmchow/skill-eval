import type { BenchmarkArtifact } from "./types.ts";

export function analyzeBenchmark(benchmark: BenchmarkArtifact): string[] {
  const notes: string[] = [];
  for (const [partition, data] of Object.entries(benchmark.partitions)) {
    const left = data.versions[benchmark.comparison.left]!;
    const right = data.versions[benchmark.comparison.right]!;
    const delta = data.delta;
    const durationDelta = delta.duration_ms ?? 0;
    if (delta.pass_rate === 0) notes.push(`${partition}: aggregate pass rate is non-discriminating between versions.`);
    if ((right.pass_rate.stddev ?? 0) >= 0.2 || (left.pass_rate.stddev ?? 0) >= 0.2) notes.push(`${partition}: pass rate is highly variable; inspect repeated cases before confirmation.`);
    if (durationDelta > 0) notes.push(`${partition}: candidate duration increased by ${Math.round(durationDelta)} ms on average.`);
  }
  return notes;
}
