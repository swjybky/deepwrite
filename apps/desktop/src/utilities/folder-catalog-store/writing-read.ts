import {
  BookSchema,
  toCreativePlotStage,
  createShortWorkspaceContentRevision,
  type BookProjectManifest,
  type WritingReadQuery,
  type WritingIndex,
  type WritingFile
} from "@deepwrite/contracts";

type WritingMetrics = Omit<WritingIndex["counts"][number], "id">;

export function writingFileMetrics(content: string): WritingMetrics {
  return {
    revision: createShortWorkspaceContentRevision(content),
    length: content.length,
    characters: content.replace(/\s/gu, "").length
  };
}

export async function queryWritingWorkspace(
  manifest: BookProjectManifest,
  query: WritingReadQuery,
  runId: string,
  readMarkdown: (path: string) => Promise<string>,
  fileCounts: (path: string) => Promise<WritingMetrics>
): Promise<WritingIndex | WritingFile> {
  const paths = new Map(manifest.documents.map((doc) => [doc.id, doc.path]));
  const draft = manifest.schemaVersion === 1 ? undefined : manifest.draft;
  for (const section of draft?.sections ?? []) {
    paths.set(section.body.id, section.body.path);
    paths.set(section.characterState.id, section.characterState.path);
  }
  const legacyDraft =
    manifest.schemaVersion === 1
      ? (manifest.documents.find((doc) => doc.id === "draft") ??
        manifest.documents.find((doc) => doc.title === "正文编写"))
      : undefined;
  const legacyText = legacyDraft ? await readMarkdown(legacyDraft.path) : "";
  const book =
    manifest.schemaVersion === 4
      ? manifest
      : BookSchema.parse({
          ...manifest,
          documents: manifest.documents.map((doc) => ({
            ...doc,
            content: doc.id === legacyDraft?.id ? legacyText : ""
          })),
          ...(draft
            ? {
                draft: {
                  ...draft,
                  sections: draft.sections.map((section) => ({
                    ...section,
                    body: { ...section.body, content: "" },
                    characterState: { ...section.characterState, content: "" }
                  }))
                }
              }
            : {})
        });
  const plots = book.plotStages
    .filter((stage) => stage.enabled)
    .map(toCreativePlotStage);
  const structure = book.characterStructure;
  const items = structure.format === "list" ? structure.items : [];
  const overview = book.documents.find((doc) => doc.id === "character_design");
  if (!overview) throw new Error("Character overview missing from work.");
  const settings = new Set([
    overview.id,
    ...plots.map((stage) => stage.id),
    ...items.map((item) => item.id)
  ]);
  const draftFiles = book.draft.sections.flatMap((section) => [
    section.body,
    section.characterState
  ]);
  const files = [
    ...book.documents.filter((doc) => settings.has(doc.id)),
    ...draftFiles
  ];
  async function contentOf(doc: { id: string; content?: string }) {
    const path = paths.get(doc.id);
    return path ? readMarkdown(path) : (doc.content ?? "");
  }
  if (query.mode === "file") {
    const doc = files.find((file) => file.id === query.documentId);
    if (!doc)
      throw new Error("Document is outside the active writing directory.");
    const content = await contentOf(doc);
    const offset = query.offset ?? 0;
    // The effective tool view can include an unsaved append beyond the disk length.
    return {
      mode: "file",
      id: doc.id,
      ...writingFileMetrics(content),
      content:
        query.offset !== undefined || query.limit !== undefined
          ? content.slice(offset, offset + (query.limit ?? 50000))
          : content
    };
  }
  const counts: WritingIndex["counts"] = [];
  if (query.counts) {
    for (const doc of query.counts === "draft" ? draftFiles : files) {
      const path = paths.get(doc.id);
      const metrics = path
        ? await fileCounts(path)
        : writingFileMetrics(await contentOf(doc));
      counts.push({ id: doc.id, ...metrics });
    }
  }
  const ref = ({ id, title }: { id: string; title: string }) => ({ id, title });
  return {
    mode: "index",
    title: manifest.title,
    overview: ref(overview),
    plotStages: plots,
    characterStructure: structure,
    sections: book.draft.sections.map((section) => ({
      id: section.id,
      title: section.title,
      wordCountRequirement: section.wordCountRequirement,
      body: ref(section.body),
      characterState: ref(section.characterState)
    })),
    counts,
    createdSections: (manifest.schemaVersion === 4
      ? (manifest.draftSectionCreationOperations ?? [])
      : []
    )
      .filter(
        (op) =>
          op.operationId.startsWith("agent-draft-sections:") &&
          op.operationId
            .replace(/^agent-draft-sections:(?:v1:\d+:[a-f\d]{8}:)?/u, "")
            .startsWith(`${runId.slice(-120)}:`)
      )
      .flatMap((op) => op.sections)
  };
}
