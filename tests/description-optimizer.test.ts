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
    improve: async (request) => { improverInputs.push(request); return { version: `description-${request.iteration}`, description: `description ${request.iteration}` }; },
  });
  expect(result.best_version).toBe("description-2");
  expect(result.best_description).toBe("description 2");
  expect(result.status).toBe("converged");
  expect(JSON.stringify(improverInputs)).not.toContain("holdout");
});
