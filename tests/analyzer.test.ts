import { expect, test } from "bun:test";
import { analyzeBenchmark } from "../skills/skill-eval/scripts/lib/analyzer.ts";

test("surfaces discriminating power, variance, and duration without unsolicited spend estimates", () => {
  const notes = analyzeBenchmark({
    partitions: {
      training: {
        versions: {
          left: { pass_rate: { mean: 1, stddev: 0 }, duration_ms: { mean: 10 }, total_tokens: { mean: 10 }, cost_usd: { mean: 0.01 } },
          right: { pass_rate: { mean: 1, stddev: 0.4 }, duration_ms: { mean: 30 }, total_tokens: { mean: 50 }, cost_usd: { mean: 0.05 } },
        },
        delta: { pass_rate: 0, duration_ms: 20, total_tokens: 40, cost_usd: 0.04 },
      },
    },
    comparison: { left: "left", right: "right" },
  } as any);
  expect(notes.some((note) => note.includes("non-discriminating"))).toBe(true);
  expect(notes.some((note) => note.includes("variable"))).toBe(true);
  expect(notes.some((note) => note.includes("duration"))).toBe(true);
  expect(notes.some((note) => note.includes("USD") || note.includes("token"))).toBe(false);
});
