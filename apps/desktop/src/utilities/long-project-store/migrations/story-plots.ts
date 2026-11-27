import {
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  longStoryPlotBodyFileId,
  type LongProjectManifest,
  type LongWorkspaceFileReference
} from "@deepwrite/contracts";
import { createId, toJsonFileText } from "@deepwrite/shared";
import { commitLongProjectTransaction, unknownRecord } from "../io";
import { storyPlotPath } from "../paths";
import {
  MANIFEST_PATH,
  MAX_LEDGER_RECORD_BYTES,
  type SecureTextFile
} from "../types";

export function storyPlotTitleFromOutline(outline: string): string {
  const firstLine =
    outline
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const cleaned = firstLine
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^\d+[.、．)]\s*/u, "")
    .replace(/^\*\*(.+?)\*\*$/u, "$1")
    .trim();
  return (cleaned || "故事情节").slice(0, 256);
}

/**
 * Moves legacy arc.outline prose into per-arc story-plot Markdown files.
 * The outline field is cleared after migration;「故事情节」editing uses files.
 */
export async function migrateLegacyArcOutlineToStoryPlots(input: {
  projectDirectory: string;
  manifest: LongProjectManifest;
  manifestDisk: SecureTextFile;
  indexDisk: SecureTextFile;
  rawIndex: unknown;
}): Promise<boolean> {
  const rawIndex = unknownRecord(input.rawIndex);
  const plot = unknownRecord(rawIndex?.plot);
  if (!rawIndex || !plot || !Array.isArray(plot.arcs)) return false;

  const existingStoryPlots = Array.isArray(plot.storyPlots)
    ? [...plot.storyPlots]
    : [];
  const arcsWithPlots = new Set(
    existingStoryPlots
      .map((entry) => unknownRecord(entry)?.arcId)
      .filter((arcId): arcId is string => typeof arcId === "string")
  );

  const updatedAt =
    typeof rawIndex.updatedAt === "string"
      ? rawIndex.updatedAt
      : input.manifest.updatedAt;
  const nextArcs: unknown[] = [];
  const createdStoryPlots: Array<{
    id: string;
    arcId: string;
    title: string;
    order: number;
    file: LongWorkspaceFileReference;
    content: string;
  }> = [];

  for (const rawArc of plot.arcs) {
    const arc = unknownRecord(rawArc);
    if (!arc || typeof arc.id !== "string") {
      nextArcs.push(rawArc);
      continue;
    }
    const outline = typeof arc.outline === "string" ? arc.outline : "";
    if (!outline.trim() || arcsWithPlots.has(arc.id)) {
      nextArcs.push(rawArc);
      continue;
    }
    const storyPlotId = createId("storyplot");
    const path = storyPlotPath(storyPlotId, "body.md");
    const order =
      existingStoryPlots.filter((entry) => {
        const candidate = unknownRecord(entry);
        return candidate?.arcId === arc.id;
      }).length +
      createdStoryPlots.filter((entry) => entry.arcId === arc.id).length +
      1;
    createdStoryPlots.push({
      id: storyPlotId,
      arcId: arc.id,
      title: storyPlotTitleFromOutline(outline),
      order,
      file: {
        id: longStoryPlotBodyFileId(storyPlotId),
        path,
        updatedAt
      },
      content: outline
    });
    nextArcs.push({
      ...arc,
      outline: ""
    });
  }

  if (createdStoryPlots.length === 0) return false;

  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
    ...rawIndex,
    plot: {
      ...plot,
      arcs: nextArcs,
      storyPlots: [
        ...existingStoryPlots,
        ...createdStoryPlots.map(({ content: _content, ...entry }) => entry)
      ]
    }
  });
  const indexContent = toJsonFileText(nextIndex);
  const nextManifest = LongProjectManifestSchema.parse({
    ...input.manifest
  });
  await commitLongProjectTransaction({
    projectRoot: input.projectDirectory,
    operations: [
      ...createdStoryPlots.map((entry) => ({
        path: entry.file.path,
        content: entry.content,
        expectedSha256: null as string | null
      })),
      {
        path: LONG_WORKSPACE_INDEX_PATH,
        content: indexContent,
        expectedSha256: input.indexDisk.sha256
      },
      {
        path: MANIFEST_PATH,
        content: toJsonFileText(nextManifest),
        expectedSha256: input.manifestDisk.sha256
      }
    ],
    maxFileBytes: MAX_LEDGER_RECORD_BYTES
  });
  return true;
}
