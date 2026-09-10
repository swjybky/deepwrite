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
  if (
    (item.kind === "material-group" || item.kind === "skill-group") &&
    record(manifest.members)
  ) {
    const kind =
      item.kind === "material-group" ? "material-library" : "skill-library";
    for (const value of Object.values(manifest.members))
      if (typeof value === "string") result.push(`${kind}:${value}`);
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
