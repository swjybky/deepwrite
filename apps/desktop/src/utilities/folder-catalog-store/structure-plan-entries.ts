import {
  MATERIAL_STAGE_KINDS,
  reorderLibraryIds,
  type LibraryStructureOperation
} from "@deepwrite/contracts";
import { projectTransactionContentSha256 as sha } from "../project-transaction";
import type {
  StructurePlanState,
  Item,
  Library
} from "./structure-plan-context";

type EntryOperation = Extract<
  LibraryStructureOperation,
  {
    action:
      | "create-unbound-entry"
      | "reorder-entry"
      | "move-entries"
      | "delete-entries";
  }
>;
export function isEntryStructureOperation(
  op: LibraryStructureOperation
): op is EntryOperation {
  return [
    "create-unbound-entry",
    "reorder-entry",
    "move-entries",
    "delete-entries"
  ].includes(op.action);
}
export async function applyEntryStructureOperation(
  op: EntryOperation,
  state: StructurePlanState
) {
  const {
    ctx,
    request,
    organization,
    items,
    summary,
    library,
    createLibrary,
    body
  } = state;
  if (op.action === "create-unbound-entry") {
    const kind =
      request.domain === "material" ? "mixed" : (op.skillKind ?? "general");
    const existing = [...items.values()].find(
      ({ manifest }) =>
        organization.unboundLibraryIds.includes(manifest.id) &&
        ("materialKind" in manifest ||
          ("skillKind" in manifest && manifest.skillKind === kind))
    );
    const target = (existing ??
      createLibrary(
        `unbound:${kind}`,
        request.domain === "material" ? "未绑定素材" : "未绑定技能",
        kind,
        op.libraryType ?? "short",
        true
      )) as Item & { manifest: Library };
    const id = `entry-${sha(`${request.requestId}:${op.ref}`).slice(0, 24)}`;
    if (
      target.manifest.entries.some(
        (entry) => entry.id === id || entry.title === op.title
      )
    )
      throw new Error("同名或同 ID 条目已存在。");
    const path = `entries/${id}.md`;
    target.files.set(path, {
      action: "write",
      path,
      content: op.content,
      expectedSha256: null
    });
    target.manifest.entries.push({
      id,
      path,
      stageId: op.stageId,
      title: op.title,
      createdAt: ctx.now,
      updatedAt: ctx.now
    } as never);
    summary.push(`新增未绑定条目「${op.title}」\n${op.content}`);
  } else if (op.action === "reorder-entry") {
    const item = library(op.libraryId);
    const ids = reorderLibraryIds(
      item.manifest.entries.map(({ id }) => id),
      op
    );
    const entries = new Map(
      item.manifest.entries.map((entry) => [entry.id, entry])
    );
    item.manifest.entries = ids.map((id) =>
      entries.get(id)!
    ) as Library["entries"];
    summary.push(`调整「${item.manifest.title}」的条目顺序`);
  } else {
    const source = library(op.libraryId);
    if (new Set(op.entryIds).size !== op.entryIds.length)
      throw new Error("条目重复。");
    let target: (Item & { manifest: Library }) | undefined;
    if (op.action === "move-entries") {
      if (op.target.kind === "library") target = library(op.target.libraryId);
      else {
        const type =
          "materialType" in source.manifest
            ? source.manifest.materialType
            : source.manifest.skillType;
        const kind =
          "materialKind" in source.manifest
            ? "mixed"
            : source.manifest.skillKind;
        const existing = [...items.values()].find(
          ({ manifest }) =>
            organization.unboundLibraryIds.includes(manifest.id) &&
            ("materialKind" in manifest ||
              ("skillKind" in manifest && manifest.skillKind === kind))
        );
        target = (existing ??
          createLibrary(
            `unbound:${type}:${kind}`,
            request.domain === "material" ? "未绑定素材" : "未绑定技能",
            kind,
            type,
            true
          )) as Item & { manifest: Library };
      }
      if (target === source) throw new Error("条目已在目标位置。");
    }
    for (const id of op.entryIds) {
      const entry = source.manifest.entries.find((item) => item.id === id);
      if (!entry) throw new Error("条目不存在。");
      const content = await body(source, entry);
      if (target) {
        const stageId =
          op.action === "move-entries"
            ? (op.targetStageId ?? entry.stageId)
            : entry.stageId;
        if (
          op.action === "move-entries" &&
          op.targetStageId &&
          target.manifest.kind !== "deepwrite.material-library"
        )
          throw new Error("只有素材条目可以调整内容阶段。");
        if (target.manifest.entries.some((item) => item.id === id))
          throw new Error("目标库已存在同 ID 条目。");
        if (
          target.manifest.kind === "deepwrite.material-library" &&
          target.manifest.materialKind !== "mixed" &&
          MATERIAL_STAGE_KINDS[stageId as keyof typeof MATERIAL_STAGE_KINDS] !==
            target.manifest.materialKind
        )
          throw new Error("目标库不支持该素材阶段，请选择兼容库。");
        const path = `entries/${sha(id).slice(0, 32)}.md`;
        target.files.set(path, {
          action: "write",
          path,
          content,
          expectedSha256: target.files.get(path)?.expectedSha256 ?? null
        });
        const beforeIndex =
          op.action === "move-entries" && op.beforeEntryId
            ? target.manifest.entries.findIndex(
                (item) => item.id === op.beforeEntryId
              )
            : -1;
        target.manifest.entries.splice(
          beforeIndex < 0 ? target.manifest.entries.length : beforeIndex,
          0,
          {
            ...entry,
            stageId,
            path,
            updatedAt: ctx.now
          } as never
        );
        const locations = (organization.entryLocations ??= {});
        delete locations[JSON.stringify([target.manifest.id, id])];
        for (const [key, location] of Object.entries(locations))
          if (
            location.libraryId === source.manifest.id &&
            location.entryId === id
          )
            locations[key] = { libraryId: target.manifest.id, entryId: id };
        locations[JSON.stringify([source.manifest.id, id])] = {
          libraryId: target.manifest.id,
          entryId: id
        };
        summary.push(
          `移动「${entry.title}」：${source.manifest.title} → ${target.manifest.title}；原库的作品上下文将不再包含此条目`
        );
      } else {
        summary.push(
          `删除「${source.manifest.title} / ${entry.title}」及其正文文件，无法恢复`
        );
      }
      const previous = source.files.get(entry.path);
      if (previous && previous.expectedSha256 === null)
        source.files.delete(entry.path);
      else
        source.files.set(entry.path, {
          action: "delete",
          path: entry.path,
          expectedSha256: previous?.expectedSha256 ?? sha(content)
        });
      source.manifest.entries = source.manifest.entries.filter(
        (item) => item.id !== id
      ) as Library["entries"];
    }
  }
}
