import { buildMaterialCatalogPrompt } from "./material-catalog";
import { materialCatalogEntries } from "./material-query-runtime";
import type { AgentRunInput } from "./runtime-types";

/** Shared material directory only; no parent history, skills, or material bodies. */
export function buildWorkspaceMaterialContext(input: AgentRunInput): string {
  const context = input.workspaceContext;
  const materials = context?.materialCatalog
    ? materialCatalogEntries(context.materialCatalog)
    : (context?.attachedMaterials ?? []);
  return buildMaterialCatalogPrompt(materials, input.promptLocale === "en-US");
}

export function buildSubagentMaterialContext(input: AgentRunInput): string {
  return [
    buildWorkspaceMaterialContext(input),
    ...materialCatalogNotes(input)
  ].join("\n");
}

export function materialCatalogNotes(input: AgentRunInput): string[] {
  const catalog = input.workspaceContext?.materialCatalog;
  return catalog
    ? [
        input.promptLocale === "en-US"
          ? `${catalog.total} materials available.`
          : `本轮可查询素材共 ${catalog.total} 条。`,
        ...(catalog.nextCursor !== undefined
          ? [
              input.promptLocale === "en-US"
                ? `More entries: use mode=list, cursor=${catalog.nextCursor}.`
                : `目录还有后续条目，调用 query_linked_material_entries（mode=list，cursor=${catalog.nextCursor}）继续。`
            ]
          : []),
        ...catalog.notices
      ]
    : input.workspaceContext?.materialReadNotice
      ? [input.workspaceContext.materialReadNotice]
      : [];
}
