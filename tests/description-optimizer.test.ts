import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDescriptionOptimizationLoop } from "../skills/skill-eval/scripts/lib/description-optimizer.ts";

test("selects descriptions by held-out score while blinding the improver", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-description-optimize-"));
  const improverInputs: any[] = [];
  const scores: Record<string, { training: number; holdout: number }> = {
    authored: { training: 0.5, holdout: 0.5 },
    "description-1": { training: 1, holdout: 0.75 },
    "description-2": { training: 1, holdout: 1 },
  };
  const result = await runDescriptionOptimizationLoop({
    runDir, initialVersion: "authored", maxIterations: 5,
    evaluate: async (version) => ({ version, ...scores[version]!, training_failures: version === "authored" ? ["missed planning intent"] : [] }),
    improve: async (request) => { improverInputs.push(request); return { version: `description-${request.iteration}`, description: `description ${request.iteration}`, hypothesis: `separate intent ${request.iteration}` }; },
  });
  expect(result.best_version).toBe("description-2");
  expect(result.best_description).toBe("description 2");
  expect(result.status).toBe("converged");
  expect(result.history[1]).toMatchObject({ hypothesis: "separate intent 1", takeaway: "held-out score improved by 0.25" });
  expect(JSON.stringify(improverInputs)).not.toContain("holdout");
});

test("does not select score movement below the meaningful improvement threshold", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-description-threshold-"));
  const result = await runDescriptionOptimizationLoop({
    runDir,
    initialVersion: "authored",
    maxIterations: 1,
    minimumImprovement: 0.05,
    evaluate: async (version) => version === "authored"
      ? { version, training: 0.8, holdout: 0.8, training_failures: ["ambiguous"] }
      : { version, training: 0.81, holdout: 0.83, training_failures: [] },
    improve: async () => ({ version: "description-1", description: "candidate", hypothesis: "clarify adjacent intent" }),
  });

  expect(result.best_version).toBe("authored");
  expect(result.history[1]).toMatchObject({ selected: false, hypothesis: "clarify adjacent intent" });
});

test("records cross-model convergence in iteration takeaways", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "skill-eval-description-cross-model-"));
  const disagreement = { hosts: { claude: { accuracy: 0.5, stability: 1 }, codex: { accuracy: 1, stability: 0.5 } }, disagreements: [{ query_id: "adjacent", hosts: {} }] };
  const agreement = { hosts: { claude: { accuracy: 1, stability: 1 }, codex: { accuracy: 1, stability: 1 } }, disagreements: [] };
  const progress: any[] = [];
  const result = await runDescriptionOptimizationLoop({
    runDir, initialVersion: "authored", maxIterations: 1,
    evaluate: async (version) => version === "authored"
      ? { version, training: 0.5, holdout: 0.5, training_failures: ["adjacent"], cross_model: { training: disagreement, holdout: disagreement } }
      : { version, training: 1, holdout: 1, training_failures: [], cross_model: { training: agreement, holdout: agreement } },
    improve: async () => ({ version: "description-1", description: "candidate", hypothesis: "clarify the boundary" }),
    onProgress: (event) => { progress.push(event); },
  });

  expect(result.history[1]?.takeaway).toContain("cross-model disagreements 2 -> 0");
  expect(progress[1]?.takeaway).toContain("cross-model disagreements 2 -> 0");
  expect(progress[1]?.cross_model.holdout.disagreements).toHaveLength(0);
});
