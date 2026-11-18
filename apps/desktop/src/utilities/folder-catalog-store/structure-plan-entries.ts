import {
  reorderLibraryIds,
  type LibraryStructureOperation
} from "@deepwrite/contracts";
import { projectTransactionContentSha256 as sha } from "../project-transaction";
import { nextCopyTitle } from "../copy-title";
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
      | "copy-entries"
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
    "copy-entries",
    "move-entries",
    "delete-entries"
  ].includes(op.action);
}
export async function applyEntryStructureOperation(
  op: EntryOperation,
  state: StructurePlanState,
  operationIndex: number
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
    const source = library(op.libraryId, op.action === "copy-entries");
    if (new Set(op.entryIds).size !== op.entryIds.length)
      throw new Error("条目重复。");
    let target: (Item & { manifest: Library }) | undefined;
    if (op.action === "move-entries" || op.action === "copy-entries") {
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
      if (
        op.action === "move-entries" &&
        target === source &&
        !op.targetStageId
      )
        throw new Error("条目已在目标位置。");
    }
    for (const id of op.entryIds) {
      const entry = source.manifest.entries.find((item) => item.id === id);
      if (!entry) throw new Error("条目不存在。");
      const content = await body(source, entry);
      if (target && op.action !== "delete-entries") {
        const stageId = op.targetStageId ?? entry.stageId;
        if (
          op.targetStageId &&
          target.manifest.kind !== "deepwrite.material-library"
        )
          throw new Error("只有素材条目可以调整内容阶段。");
        if (op.action === "copy-entries") {
          const copyId = `entry-${sha(JSON.stringify([request.requestId, operationIndex, id])).slice(0, 24)}`;
          const titles = target.manifest.entries
            .filter((item) => item.stageId === stageId)
            .map((item) => item.title);
          const title = titles.includes(entry.title)
            ? nextCopyTitle(entry.title, titles)
            : entry.title;
          const path = `entries/${copyId}.md`;
          if (target.manifest.entries.some((item) => item.id === copyId))
            throw new Error("副本 ID 已存在，请重新生成提案。");
          target.files.set(path, {
            action: "write",
            path,
            content,
            expectedSha256: null
          });
          target.manifest.entries.push({
            ...entry,
            id: copyId,
            title,
            stageId,
            path,
            createdAt: ctx.now,
            updatedAt: ctx.now
          } as never);
          summary.push(
            `复制「${source.manifest.title} / ${entry.title}」到「${target.manifest.title} / ${title}」`
          );
          continue;
        }
        if (target === source) {
          if (entry.stageId === stageId)
            throw new Error(`「${entry.title}」已在目标栏目。`);
          entry.stageId = stageId as typeof entry.stageId;
          entry.updatedAt = ctx.now;
          summary.push(`调整「${entry.title}」栏目为 ${stageId}`);
          continue;
        }
        if (target.manifest.entries.some((item) => item.id === id))
          throw new Error("目标库已存在同 ID 条目。");
        const path = `entries/${sha(id).slice(0, 32)}.md`;
        target.files.set(path, {
          action: "write",
          path,
          content,
          expectedSha256: target.files.get(path)?.expectedSha256 ?? null
        });
        const beforeIndex = op.beforeEntryId
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
