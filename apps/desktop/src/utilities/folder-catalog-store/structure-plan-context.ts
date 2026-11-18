import { join } from "node:path";
import {
  CatalogProjectManifestSchema,
  LibraryStructureRequestSchema,
  emptyLibraryOrganization,
  type CatalogProjectManifest,
  type LibraryStructureRequest
} from "@deepwrite/contracts";
import {
  projectTransactionContentSha256 as sha,
  type ProjectTransactionFileOperation
} from "../project-transaction";
import { readNoFollowFile } from "../long-project-store/io";
import type { FolderCatalogRegistry, RegistryProject } from "./registry-types";
import { secureProjectRoot } from "./paths-io";

export type Library = Extract<
  CatalogProjectManifest,
  { kind: "deepwrite.material-library" | "deepwrite.skill-library" }
>;
export type Group = Extract<
  CatalogProjectManifest,
  { kind: "deepwrite.material-group" | "deepwrite.skill-group" }
>;
type Manifest = Library | Group;
export interface StructurePlanContext {
  registry: FolderCatalogRegistry;
  registryPath: string;
  defaultProjectParents: Readonly<Record<string, string>>;
  now: string;
  maxManifestBytes?: number;
  maxMarkdownBytes?: number;
}
export interface Item {
  manifest: Manifest;
  registration: RegistryProject;
  original: string | null;
  originalNormalized: string | null;
  files: Map<string, ProjectTransactionFileOperation>;
}

export async function createStructurePlanContext(
  raw: LibraryStructureRequest,
  ctx: StructurePlanContext
) {
  const request = LibraryStructureRequestSchema.parse(raw);
  const registry = structuredClone(ctx.registry);
  const organization = (registry.libraryOrganization ??=
    emptyLibraryOrganization());
  const items = new Map<string, Item>();
  const refs = new Map<string, string>();
  const summary: string[] = [];
  const fingerprints: string[] = [];
  const registryText = (
    await readNoFollowFile(
      ctx.registryPath,
      ctx.maxManifestBytes ?? 1024 * 1024,
      "catalog registry"
    )
  ).bytes.toString("utf8");
  for (const registration of registry.projects.filter((item) =>
    item.domain.startsWith(`${request.domain}-`)
  )) {
    const root = await secureProjectRoot(registration.projectDirectory);
    const text = (
      await readNoFollowFile(
        join(root, "deepwrite.json"),
        ctx.maxManifestBytes ?? 1024 * 1024,
        "library manifest",
        root
      )
    ).bytes.toString("utf8");
    const manifest = CatalogProjectManifestSchema.parse(JSON.parse(text));
    if (
      manifest.kind === "deepwrite.book" ||
      manifest.id !== registration.id ||
      manifest.kind !== `deepwrite.${registration.domain}`
    )
      throw new Error("资料库注册信息与清单不符。");
    items.set(manifest.id, {
      manifest,
      registration: { ...registration, projectDirectory: root },
      original: text,
      originalNormalized: JSON.stringify(manifest),
      files: new Map()
    });
    fingerprints.push(`${manifest.id}:${sha(text)}`);
  }
  const baseVersion = sha(JSON.stringify([registry, fingerprints.sort()]));
  const resolveId = (id: string) => refs.get(id) ?? id;
  function get(id: string): Item {
    const item = items.get(resolveId(id));
    if (
      !item ||
      !registry.projects.some(
        (entry) =>
          entry.id === item.manifest.id &&
          entry.domain === item.registration.domain
      )
    )
      throw new Error("目标不存在或不属于当前领域。");
    return item;
  }
  function writable(item: Item, allowUnbound = false) {
    if (
      item.manifest.kind === "deepwrite.skill-library" &&
      item.manifest.isBuiltin
    )
      throw new Error("内置技能库只读。");
    if (
      !allowUnbound &&
      organization.unboundLibraryIds.includes(item.manifest.id)
    )
      throw new Error("未绑定收纳区不能作为正式库管理。");
  }
  function library(id: string, forRead = false): Item & { manifest: Library } {
    const item = get(id);
    if (!("entries" in item.manifest)) throw new Error("目标不是资料库。");
    if (!forRead) writable(item, true);
    return item as Item & { manifest: Library };
  }
  function group(id: string): Item & { manifest: Group } {
    const item = get(id);
    if (!("memberIds" in item.manifest)) throw new Error("目标不是分组。");
    return item as Item & { manifest: Group };
  }
  function add(
    ref: string,
    title: string,
    fields: Record<string, unknown>,
    unbound = false
  ): Item {
    if (refs.has(ref) || items.has(ref))
      throw new Error("新建对象的引用重复。");
    const isGroup = "memberIds" in fields;
    const id = `${request.domain}-${isGroup ? "group" : "library"}-${sha(`${request.requestId}:${ref}`).slice(0, 24)}`;
    if (items.has(id)) throw new Error("新建对象已存在。");
    const domain =
      `${request.domain}-${isGroup ? "group" : "library"}` as RegistryProject["domain"];
    const manifest = CatalogProjectManifestSchema.parse({
      schemaVersion: 1,
      revision: 0,
      id,
      title,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      kind: `deepwrite.${domain}`,
      ...fields
    }) as Manifest;
    const registration = {
      id,
      domain,
      projectDirectory: join(ctx.defaultProjectParents[domain]!, id),
      registeredAt: ctx.now
    };
    const item = {
      manifest,
      registration,
      original: null,
      originalNormalized: null,
      files: new Map<string, ProjectTransactionFileOperation>()
    };
    items.set(id, item);
    refs.set(ref, id);
    registry.projects.push(registration);
    if (unbound) organization.unboundLibraryIds.push(id);
    return item;
  }
  function createLibrary(
    ref: string,
    title: string,
    kind: string,
    libraryType: string,
    unbound = false,
    customTag?: string
  ) {
    return add(
      ref,
      title,
      request.domain === "material"
        ? {
            materialKind: kind,
            materialType: libraryType,
            ...(customTag ? { customTag } : {}),
            parentGenre: "",
            subGenre: "",
            overview: "",
            entries: []
          }
        : {
            skillKind: kind,
            skillType: libraryType,
            ...(customTag ? { customTag } : {}),
            overview: "",
            isBuiltin: false,
            entries: []
          },
      unbound
    );
  }
  function setMembers(
    item: Item & { manifest: Group },
    memberRefs: readonly string[]
  ) {
    const next: string[] = [];
    for (const ref of memberRefs) {
      if (!ref) continue;
      const member = library(ref);
      writable(member);
      if (next.includes(member.manifest.id)) throw new Error("分组成员重复。");
      for (const other of items.values())
        if (
          other !== item &&
          "memberIds" in other.manifest &&
          registry.projects.some(({ id }) => id === other.manifest.id) &&
          other.manifest.memberIds.includes(member.manifest.id)
        )
          throw new Error("该库已加入其它分组，请先移出。");
      next.push(member.manifest.id);
    }
    item.manifest.memberIds = next;
  }
  function rootIds() {
    const active = [...items.values()].filter((item) =>
      registry.projects.some(({ id }) => id === item.manifest.id)
    );
    const groups = active.filter((item) => "memberIds" in item.manifest);
    const grouped = new Set(
      groups.flatMap(({ manifest }) =>
        "memberIds" in manifest ? manifest.memberIds : []
      )
    );
    return [
      ...groups,
      ...active.filter(
        ({ manifest }) =>
          "entries" in manifest &&
          !grouped.has(manifest.id) &&
          !organization.unboundLibraryIds.includes(manifest.id)
      )
    ].map(({ manifest }) => manifest.id);
  }
  function remove(item: Item) {
    writable(item);
    // Keep project files for recovery through Open Existing, never unlink a library folder.
    registry.projects = registry.projects.filter(
      (entry) =>
        entry.id !== item.manifest.id ||
        entry.domain !== item.registration.domain
    );
    for (const other of items.values())
      if ("memberIds" in other.manifest)
        other.manifest.memberIds = other.manifest.memberIds.filter(
          (id) => id !== item.manifest.id
        );
  }
  async function body(
    item: Item & { manifest: Library },
    entry: Library["entries"][number]
  ) {
    const pending = item.files.get(entry.path);
    if (pending && pending.action !== "delete" && pending.action !== "check")
      return pending.content;
    const text = (
      await readNoFollowFile(
        join(item.registration.projectDirectory, entry.path),
        ctx.maxMarkdownBytes ?? 32 * 1024 * 1024,
        "entry",
        item.registration.projectDirectory
      )
    ).bytes.toString("utf8");
    // Entry bodies are part of the optimistic read set, even for metadata-only operations.
    const expectedSha256 = sha(text);
    fingerprints.push(`${item.manifest.id}/${entry.id}:${expectedSha256}`);
    item.files.set(entry.path, {
      action: "check",
      path: entry.path,
      expectedSha256
    });
    return text;
  }
  return {
    ctx,
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
    remove,
    body
  };
}
export type StructurePlanState = Awaited<
  ReturnType<typeof createStructurePlanContext>
>;
