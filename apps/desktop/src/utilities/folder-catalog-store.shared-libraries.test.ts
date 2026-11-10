import {
  FolderCatalogStore,
  makeTemporaryRoot,
  join,
  describe,
  it,
  expect,
  readFile
} from "./folder-catalog-store.test-support";
import {
  MaterialLibraryProjectManifestSchema,
  SkillLibraryProjectManifestSchema,
  resolveLibraryEntryLocation
} from "@deepwrite/contracts";

const legacyTypes = ["short", "script", "long"] as const;
describe("libraries shared across legacy writing types", () => {
  it.each(["material", "skill"] as const)(
    "keeps legacy %s manifests readable and moves entries across types",
    async (domain) => {
      const root = await makeTemporaryRoot("deepwrite-shared-libraries-");
      const store = new FolderCatalogStore({ userDataPath: root });
      const libraries = await Promise.all(
        legacyTypes.map(
          async (libraryType) =>
            (
              await store.createLibrary(
                domain === "material"
                  ? {
                      domain,
                      name: libraryType,
                      libraryType,
                      materialKind: "other"
                    }
                  : {
                      domain,
                      name: libraryType,
                      libraryType,
                      skillKind: "general"
                    }
              )
            ).resource
        )
      );
      const manifests = await Promise.all(
        libraries.map(async ({ id }) => {
          const path = join(await store.projectDirectory(id), "deepwrite.json");
          return { path, content: await readFile(path, "utf8") };
        })
      );
      await new FolderCatalogStore({ userDataPath: root }).snapshot();
      for (const { path, content } of manifests)
        expect(await readFile(path, "utf8")).toBe(content);
      const original = libraries[0]!;
      const entry = await store.createLibraryEntry(
        domain === "material"
          ? {
              domain,
              libraryId: original.id,
              title: "旧条目",
              content: "完整旧正文",
              stageId: "other"
            }
          : {
              domain,
              libraryId: original.id,
              title: "旧条目",
              content: "完整旧正文",
              stageId: "draft"
            }
      );
      await store.moveLibraryEntry({
        domain,
        sourceLibraryId: original.id,
        targetLibraryId: libraries[1]!.id,
        entryId: entry.id,
        sourceBaseProjectRevision: 1,
        targetBaseProjectRevision: 0
      });
      const plan = await store.previewLibraryStructure({
        domain,
        requestId: `cross-type-${domain}`,
        operations: [
          {
            action: "move-entries",
            libraryId: libraries[1]!.id,
            entryIds: [entry.id],
            target: { kind: "library", libraryId: libraries[2]!.id }
          }
        ]
      });
      await store.applyLibraryStructure(plan);
      const reopened = new FolderCatalogStore({ userDataPath: root });
      const snapshot = await reopened.snapshot();
      const pool = domain === "material" ? snapshot.materials : snapshot.skills;
      expect(
        pool.find(({ id }) => id === libraries[2]!.id)?.entries[0]
      ).toMatchObject({
        id: entry.id,
        title: "旧条目",
        body: "完整旧正文"
      });
      expect(
        (
          await reopened.readDocument({
            projectId: original.id,
            target: "document",
            documentId: entry.id
          })
        ).content
      ).toBe("完整旧正文");
      expect(
        resolveLibraryEntryLocation(
          snapshot.libraryOrganization,
          original.id,
          entry.id
        )
      ).toEqual({ libraryId: libraries[2]!.id, entryId: entry.id });
      for (const [index, { path }] of manifests.entries()) {
        const raw = JSON.parse(await readFile(path, "utf8"));
        const schema =
          domain === "material"
            ? MaterialLibraryProjectManifestSchema
            : SkillLibraryProjectManifestSchema;
        expect(schema.parse(raw)).toMatchObject({
          id: libraries[index]!.id,
          schemaVersion: 1,
          [domain === "material" ? "materialType" : "skillType"]:
            legacyTypes[index]
        });
      }
    }
  );

  it.each(["material", "skill"] as const)(
    "reuses a legacy %s unbound container across old and new requests",
    async (domain) => {
      const root = await makeTemporaryRoot("deepwrite-shared-unbound-");
      const store = new FolderCatalogStore({ userDataPath: root });
      const legacy = await store.createUnboundEntry({
        domain,
        libraryType: "script",
        title: "旧条目",
        content: "旧内容",
        stageId: domain === "material" ? "other" : "draft"
      });
      for (const libraryType of ["short", "long", undefined] as const) {
        const entry = await store.createUnboundEntry({
          domain,
          title: `新条目-${libraryType}`,
          content: "新内容",
          stageId: domain === "material" ? "other" : "draft",
          ...(libraryType ? { libraryType } : {})
        });
        expect(entry.libraryId).toBe(legacy.libraryId);
      }
      const plan = await store.previewLibraryStructure({
        domain,
        requestId: `shared-loose-${domain}`,
        operations: [
          {
            action: "create-unbound-entry",
            ref: "new",
            title: "智能体新增",
            content: "提案正文",
            stageId: domain === "material" ? "other" : "draft"
          }
        ]
      });
      await store.applyLibraryStructure(plan);
      const snapshot = await new FolderCatalogStore({
        userDataPath: root
      }).snapshot();
      const pool = domain === "material" ? snapshot.materials : snapshot.skills;
      expect(pool).toHaveLength(1);
      expect(pool[0]?.entries).toHaveLength(5);
      expect(pool[0]).toMatchObject({
        [domain === "material" ? "materialType" : "skillType"]: "script"
      });
    }
  );
});
