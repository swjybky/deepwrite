import type { SyncItem } from "./schemas";
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function syncDependencies(item: SyncItem): string[] {
  const manifest: unknown = JSON.parse(item.files["deepwrite.json"] ?? "null");
  if (!record(manifest)) return [];
  const result: string[] = [];
  for (const [field, kind] of [
    ["linkedMaterialIdsByKind", "material-library"],
    ["linkedSkillIdsByKind", "skill-library"]
  ] as const) {
    const bindings = manifest[field];
    if (record(bindings))
      for (const values of Object.values(bindings))
        if (Array.isArray(values))
          for (const id of values)
            if (typeof id === "string") result.push(`${kind}:${id}`);
  }
  for (const [field, kind] of [
    ["linkedMaterialIds", "material-library"],
    ["linkedSkillIds", "skill-library"]
  ] as const) {
    const ids = manifest[field];
    if (Array.isArray(ids))
      for (const id of ids)
        if (typeof id === "string") result.push(`${kind}:${id}`);
  }
  if (item.kind === "material-group" || item.kind === "skill-group") {
    const kind =
      item.kind === "material-group" ? "material-library" : "skill-library";
    if (Array.isArray(manifest.memberIds)) {
      for (const value of manifest.memberIds)
        if (typeof value === "string") result.push(`${kind}:${value}`);
    } else if (record(manifest.members)) {
      for (const value of Object.values(manifest.members))
        if (typeof value === "string") result.push(`${kind}:${value}`);
    }
  }
  return [...new Set(result)];
}
export function syncDependencyOrder(key: string): number {
  return key.startsWith("book:") || key.startsWith("long-book:")
    ? 2
    : key.includes("-group:")
      ? 1
      : 0;
}
