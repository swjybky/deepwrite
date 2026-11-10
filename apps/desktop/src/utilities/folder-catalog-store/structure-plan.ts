import { assertJsonByteLength, assertTextByteLength } from "./paths-io";
import { dirname } from "node:path";
import {
  CatalogProjectManifestSchema,
  LibraryOrganizationSchema,
  reconcileLibraryOrder,
  reorderLibraryIds,
  type LibraryStructureRequest,
  type LibraryStructurePlan
} from "@deepwrite/contracts";
import { projectTransactionContentSha256 as sha } from "../project-transaction";
import type { StructureTransactionRoot } from "./structure-transaction";
import {
  createStructurePlanContext,
  type StructurePlanContext,
  type Item,
  type Group
} from "./structure-plan-context";
import {
  applyEntryStructureOperation,
  isEntryStructureOperation
} from "./structure-plan-entries";

export async function planLibraryStructure(
  raw: LibraryStructureRequest,
  ctx: StructurePlanContext
): Promise<{ plan: LibraryStructurePlan; roots: StructureTransactionRoot[] }> {
  const state = await createStructurePlanContext(raw, ctx);
  const {
    request,
    registry,
    organization,
    items,
    summary,
    fingerprints,
    registryText,
    baseVersion,
    resolveId,
    get,
    writable,
    library,
    group,
    add,
    createLibrary,
    setMembers,
    rootIds,
    remove
  } = state;
  for (const op of request.operations) {
    if (isEntryStructureOperation(op)) {
      await applyEntryStructureOperation(op, state);
      continue;
    }
    if (op.action === "create-library") {
      createLibrary(op.ref, op.title, op.kind, op.libraryType ?? "short");
      summary.push(`新建库「${op.title}」`);
    } else if (op.action === "create-group") {
      const item = add(op.ref, op.title, { members: {} });
      setMembers(item as Item & { manifest: Group }, op.members);
      summary.push(`新建分组「${op.title}」`);
    } else if (op.action === "rename-library" || op.action === "rename-group") {
      const item =
        op.action === "rename-library" ? library(op.id) : group(op.id);
      writable(item);
      summary.push(`改名：${item.manifest.title} → ${op.title}`);
      item.manifest.title = op.title;
    } else if (op.action === "set-members") {
      const item = group(op.id);
      const before = Object.values(item.manifest.members)
        .map((id) => (id ? get(id).manifest.title : ""))
        .join("、");
      setMembers(item, op.members);
      summary.push(
        `分组「${item.manifest.title}」：${before || "空"} → ${
          Object.values(item.manifest.members)
            .map((id) => (id ? get(id).manifest.title : ""))
            .join("、") || "空"
        }`
      );
    } else if (
      op.action === "reorder-library" ||
      op.action === "reorder-group"
    ) {
      const item =
        op.action === "reorder-library" ? library(op.id) : group(op.id);
      writable(item);
      const groupId = op.groupId ? resolveId(op.groupId) : undefined;
      const ids = groupId
        ? Object.values(group(groupId).manifest.members).filter(
            (id): id is string => !!id
          )
        : rootIds();
      const next = reorderLibraryIds(
        reconcileLibraryOrder(
          ids,
          groupId
            ? (organization.groups[groupId] ?? [])
            : organization[request.domain]
        ),
        { ...op, id: item.manifest.id, anchorId: resolveId(op.anchorId) }
      );
      if (groupId) organization.groups[groupId] = next;
      else organization[request.domain] = next;
      summary.push(
        `排序：${item.manifest.title} → ${get(op.anchorId).manifest.title}${op.position === "before" ? "之前" : "之后"}`
      );
    } else if (op.action === "delete-library") {
      const item = library(op.id);
      summary.push(
        `移除库「${item.manifest.title}」（${item.manifest.entries.length} 条），保留本地文件，可通过打开已有库恢复；作品不再读取此库`
      );
      remove(item);
    } else if (op.action === "dissolve-group" || op.action === "delete-group") {
      const item = group(op.id);
      const members = Object.values(item.manifest.members).filter(
        (id): id is string => !!id
      );
      const order = reconcileLibraryOrder(
        rootIds(),
        organization[request.domain]
      );
      const position = order.indexOf(item.manifest.id);
      const removeMembers = op.action === "delete-group" && op.includeLibraries;
      order.splice(
        position,
        1,
        ...(removeMembers
          ? []
          : reconcileLibraryOrder(
              members,
              organization.groups[item.manifest.id] ?? []
            ))
      );
      organization[request.domain] = order;
      if (removeMembers)
        for (const id of members) {
          if (
            [...items.values()].some(
              (other) =>
                other !== item &&
                "members" in other.manifest &&
                registry.projects.some(
                  (project) => project.id === other.manifest.id
                ) &&
                Object.values(other.manifest.members).includes(id)
            )
          )
            throw new Error(
              "成员库仍被其它分组使用，不能随组删除；请先调整成员关系。"
            );
          const member = library(id);
          summary.push(
            `移除成员库「${member.manifest.title}」（${member.manifest.entries.length} 条），保留文件；作品不再读取此库`
          );
          remove(member);
        }
      summary.push(
        `${removeMembers ? "删除" : "解散"}分组「${item.manifest.title}」，${removeMembers ? "成员库移出列表" : "保留全部成员库及正文"}`
      );
      remove(item);
    }
  }
  const roots: StructureTransactionRoot[] = [];
  for (const item of items.values()) {
    const current = JSON.stringify(item.manifest);
    if (
      item.original !== null &&
      current === JSON.stringify(JSON.parse(item.original)) &&
      !item.files.size
    ) {
      roots.push({
        root: item.registration.projectDirectory,
        files: [
          {
            action: "check",
            path: "deepwrite.json",
            expectedSha256: sha(item.original)
          }
        ]
      });
      continue;
    }
    if (item.original !== null) {
      item.manifest.revision += 1;
      item.manifest.updatedAt = ctx.now;
    }
    const manifest = CatalogProjectManifestSchema.parse(item.manifest);
    assertJsonByteLength(manifest, ctx.maxManifestBytes ?? 1024 * 1024);
    for (const file of item.files.values())
      if (file.action === "write")
        assertTextByteLength(
          file.content,
          ctx.maxMarkdownBytes ?? 32 * 1024 * 1024,
          "entry"
        );
    item.files.set("deepwrite.json", {
      action: "write",
      path: "deepwrite.json",
      content: JSON.stringify(manifest),
      expectedSha256: item.original === null ? null : sha(item.original)
    });
    roots.push({
      root: item.registration.projectDirectory,
      files: [...item.files.values()]
    });
  }
  LibraryOrganizationSchema.parse(organization);
  organization.revision += 1;
  registry.revision += 1;
  registry.updatedAt = ctx.now;
  assertJsonByteLength(registry, ctx.maxManifestBytes ?? 1024 * 1024);
  roots.push({
    root: dirname(ctx.registryPath),
    files: [
      {
        action: "write",
        path: "catalog-registry.json",
        content: JSON.stringify(registry),
        expectedSha256: sha(registryText)
      }
    ]
  });
  return {
    plan: {
      ...request,
      baseVersion: sha(JSON.stringify([baseVersion, fingerprints.sort()])),
      summary: summary.join("\n")
    },
    roots
  };
}
