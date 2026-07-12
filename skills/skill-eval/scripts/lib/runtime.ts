import type { HostName, RuntimeRoleGroup, RuntimeRoleProfiles } from "./types.ts";

export interface LegacyRuntimeOverrides {
  models?: Partial<Record<HostName, string>>;
  reasoningEfforts?: Partial<Record<HostName, string>>;
  runtimeProfiles?: RuntimeRoleProfiles;
}

export function runtimeOverrides(options: LegacyRuntimeOverrides, role: RuntimeRoleGroup): {
  models: Partial<Record<HostName, string>>;
  reasoningEfforts: Partial<Record<HostName, string>>;
} {
  const profile = options.runtimeProfiles?.[role] ?? {};
  const models: Partial<Record<HostName, string>> = { ...options.models };
  const reasoningEfforts: Partial<Record<HostName, string>> = { ...options.reasoningEfforts };
  for (const host of ["claude", "codex"] as HostName[]) {
    if (profile[host]?.model) models[host] = profile[host]!.model!;
    if (profile[host]?.reasoning_effort) reasoningEfforts[host] = profile[host]!.reasoning_effort!;
  }
  return { models, reasoningEfforts };
}
