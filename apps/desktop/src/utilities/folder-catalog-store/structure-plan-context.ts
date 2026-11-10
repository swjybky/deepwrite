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
  function library(id: string): Item & { manifest: Library } {
    const item = get(id);
    if (!("entries" in item.manifest)) throw new Error("目标不是资料库。");
    writable(item, true);
    return item as Item & { manifest: Library };
  }
  function group(id: string): Item & { manifest: Group } {
    const item = get(id);
    if (!("members" in item.manifest)) throw new Error("目标不是分组。");
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
    const isGroup = "members" in fields;
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
    unbound = false
  ) {
    return add(
      ref,
      title,
      request.domain === "material"
        ? {
            materialKind: kind,
            materialType: libraryType,
            parentGenre: "",
            subGenre: "",
            overview: "",
            entries: []
          }
        : {
            skillKind: kind,
            skillType: libraryType,
            overview: "",
            isBuiltin: false,
            entries: []
          },
      unbound
    );
  }
  function setMembers(
    item: Item & { manifest: Group },
    members: Partial<Record<string, string>>
  ) {
    const next: Record<string, string> = {};
    for (const [kind, ref] of Object.entries(members)) {
      if (!ref) continue;
      const member = library(ref);
      writable(member);
      const memberKind =
        "materialKind" in member.manifest
          ? member.manifest.materialKind
          : member.manifest.skillKind;
      if (memberKind !== kind && memberKind !== "mixed")
        throw new Error("分组成员类别不兼容。");
      if (Object.values(next).includes(member.manifest.id))
        throw new Error("分组成员重复。");
      for (const other of items.values())
        if (
          other !== item &&
          "members" in other.manifest &&
          registry.projects.some(({ id }) => id === other.manifest.id) &&
          Object.values(other.manifest.members).includes(member.manifest.id)
        )
          throw new Error("该库已加入其它分组，请先移出。");
      next[kind] = member.manifest.id;
    }
    const keys =
      request.domain === "material"
        ? ["character", "gimmick", "plot", "draft", "other"]
        : ["general", "plot", "style", "other"];
    if (Object.keys(next).some((key) => !keys.includes(key)))
      throw new Error("分组类别不属于当前领域。");
    item.manifest.members = next;
  }
  function rootIds() {
    const active = [...items.values()].filter((item) =>
      registry.projects.some(({ id }) => id === item.manifest.id)
    );
    const groups = active.filter((item) => "members" in item.manifest);
    const grouped = new Set(
      groups.flatMap(({ manifest }) =>
        "members" in manifest ? Object.values(manifest.members) : []
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
      if ("members" in other.manifest)
        for (const [kind, id] of Object.entries(other.manifest.members))
          if (id === item.manifest.id)
            delete (other.manifest.members as Record<string, string>)[kind];
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
    fingerprints.push(`${item.manifest.id}/${entry.id}:${sha(text)}`);
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
