import {
  BookSchema,
  toCreativePlotStage,
  createShortWorkspaceContentRevision,
  type AcademicWritingIndex,
  type BookProjectManifest,
  type CurrentAcademicBookProjectManifest,
  type WritingReadQuery,
  type WritingIndex,
  type WritingFile,
  type WritingSearchMatch,
  type WritingSearchMatchKind,
  type WritingSearchResult
} from "@deepwrite/contracts";

type WritingMetrics = Omit<WritingIndex["counts"][number], "id">;

export function writingFileMetrics(content: string): WritingMetrics {
  return {
    revision: createShortWorkspaceContentRevision(content),
    length: content.length,
    characters: content.replace(/\s/gu, "").length
  };
}

interface SearchTarget {
  kind: WritingSearchMatchKind;
  objectId: string;
  documentId: string;
  title: string;
  path?: string | undefined;
  inlineContent?: string | undefined;
  citeKey?: string | undefined;
  chapterId?: string | undefined;
}

function buildSnippet(
  content: string,
  needleLower: string
): {
  snippet: string;
  matchCount: number;
} | null {
  const lower = content.toLocaleLowerCase("en-US");
  let pos = lower.indexOf(needleLower);
  if (pos < 0) return null;
  const firstPos = pos;
  let count = 0;
  while (pos >= 0) {
    count += 1;
    pos = lower.indexOf(needleLower, pos + Math.max(1, needleLower.length));
  }
  const start = Math.max(0, firstPos - 60);
  const end = Math.min(content.length, firstPos + needleLower.length + 100);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  const excerpt = content.slice(start, end).replace(/\s+/gu, " ").trim();
  return { snippet: `${prefix}${excerpt}${suffix}`, matchCount: count };
}

async function executeWritingSearch(
  targets: readonly SearchTarget[],
  queryText: string,
  limit: number | undefined,
  readMarkdown: (path: string) => Promise<string>
): Promise<WritingSearchResult> {
  const needle = queryText.trim();
  const needleLower = needle.toLocaleLowerCase("en-US");
  const maxMatches = limit ?? 30;
  const allMatches: WritingSearchMatch[] = [];
  for (const target of targets) {
    const content = target.path
      ? await readMarkdown(target.path)
      : (target.inlineContent ?? "");
    const titleHit = target.title
      .toLocaleLowerCase("en-US")
      .includes(needleLower);
    const keyHit = target.citeKey
      ? target.citeKey.toLocaleLowerCase("en-US").includes(needleLower)
      : false;
    const bodyMatch = buildSnippet(content, needleLower);
    if (!bodyMatch && !titleHit && !keyHit) continue;
    allMatches.push({
      kind: target.kind,
      objectId: target.objectId,
      documentId: target.documentId,
      title: target.title,
      ...(target.citeKey ? { citeKey: target.citeKey } : {}),
      ...(target.chapterId ? { chapterId: target.chapterId } : {}),
      snippet:
        bodyMatch?.snippet ??
        content.slice(0, 160).replace(/\s+/gu, " ").trim(),
      matchCount: bodyMatch ? bodyMatch.matchCount : 1
    });
  }
  return {
    mode: "search",
    query: needle,
    totalMatches: allMatches.length,
    matches: allMatches.slice(0, maxMatches)
  };
}

async function queryAcademicWritingWorkspace(
  manifest: CurrentAcademicBookProjectManifest,
  query: WritingReadQuery,
  readMarkdown: (path: string) => Promise<string>,
  fileCounts: (path: string) => Promise<WritingMetrics>
): Promise<AcademicWritingIndex | WritingFile | WritingSearchResult> {
  const enabledStageIds = new Set(
    manifest.frameworkStages.filter((s) => s.enabled).map((s) => s.id)
  );
  const paths = new Map<string, string>([
    [
      manifest.foundation.thesisOverview.id,
      manifest.foundation.thesisOverview.path
    ],
    [manifest.foundation.terminology.id, manifest.foundation.terminology.path]
  ]);
  for (const card of manifest.foundation.cards) {
    paths.set(card.document.id, card.document.path);
  }
  for (const doc of manifest.documents) {
    if (enabledStageIds.has(doc.id)) {
      paths.set(doc.id, doc.path);
    }
  }
  for (const section of manifest.manuscript.sections) {
    paths.set(section.brief.id, section.brief.path);
    paths.set(section.body.id, section.body.path);
    paths.set(section.state.id, section.state.path);
  }

  if (query.mode === "file") {
    let resolvedDocId = query.documentId;
    if (!paths.has(resolvedDocId)) {
      const cardByIdOrKey = manifest.foundation.cards.find(
        (card) =>
          card.id === resolvedDocId ||
          card.citeKey.toLocaleLowerCase("en-US") ===
            resolvedDocId.toLocaleLowerCase("en-US")
      );
      if (cardByIdOrKey) {
        resolvedDocId = cardByIdOrKey.document.id;
      }
    }
    const filePath = paths.get(resolvedDocId);
    if (!filePath) {
      throw new Error("Document is outside the active academic workspace.");
    }
    const content = await readMarkdown(filePath);
    const offset = query.offset ?? 0;
    return {
      mode: "file",
      id: resolvedDocId,
      ...writingFileMetrics(content),
      content:
        query.offset !== undefined || query.limit !== undefined
          ? content.slice(offset, offset + (query.limit ?? 50000))
          : content
    };
  }

  if (query.mode === "search") {
    const targets: SearchTarget[] = [
      {
        kind: "thesis_overview",
        objectId: manifest.foundation.thesisOverview.id,
        documentId: manifest.foundation.thesisOverview.id,
        title: manifest.foundation.thesisOverview.title,
        path: manifest.foundation.thesisOverview.path
      },
      {
        kind: "terminology",
        objectId: manifest.foundation.terminology.id,
        documentId: manifest.foundation.terminology.id,
        title: manifest.foundation.terminology.title,
        path: manifest.foundation.terminology.path
      },
      ...manifest.foundation.cards.map((card): SearchTarget => ({
        kind: "reference_card",
        objectId: card.id,
        documentId: card.document.id,
        title: card.title,
        citeKey: card.citeKey,
        path: card.document.path
      })),
      ...manifest.documents
        .filter((doc) => enabledStageIds.has(doc.id))
        .map((doc): SearchTarget => ({
          kind: "framework_stage",
          objectId: doc.id,
          documentId: doc.id,
          title: doc.title,
          path: doc.path
        })),
      ...manifest.manuscript.sections.flatMap((section): SearchTarget[] => [
        {
          kind: "section_brief",
          objectId: section.id,
          documentId: section.brief.id,
          title: section.brief.title,
          chapterId: section.chapterId,
          path: section.brief.path
        },
        {
          kind: "section_body",
          objectId: section.id,
          documentId: section.body.id,
          title: section.title,
          chapterId: section.chapterId,
          path: section.body.path
        },
        {
          kind: "section_state",
          objectId: section.id,
          documentId: section.state.id,
          title: section.state.title,
          chapterId: section.chapterId,
          path: section.state.path
        }
      ])
    ];
    return executeWritingSearch(
      targets,
      query.query,
      query.limit,
      readMarkdown
    );
  }

  const counts: AcademicWritingIndex["counts"] = [];
  if (query.counts) {
    const entriesToCount =
      query.counts === "draft"
        ? manifest.manuscript.sections.flatMap((section) => [
            section.brief,
            section.body,
            section.state
          ])
        : [
            manifest.foundation.thesisOverview,
            manifest.foundation.terminology,
            ...manifest.foundation.cards.map((c) => c.document),
            ...manifest.documents.filter((doc) => enabledStageIds.has(doc.id)),
            ...manifest.manuscript.sections.flatMap((section) => [
              section.brief,
              section.body,
              section.state
            ])
          ];
    for (const doc of entriesToCount) {
      counts.push({ id: doc.id, ...(await fileCounts(doc.path)) });
    }
  }

  const ref = ({ id, title }: { id: string; title: string }) => ({ id, title });
  return {
    mode: "index",
    bookType: "academic",
    projectRevision: manifest.revision,
    title: manifest.title,
    subtype: manifest.subtype,
    citationStyle: manifest.citationStyle,
    foundation: {
      thesisOverview: ref(manifest.foundation.thesisOverview),
      terminology: ref(manifest.foundation.terminology),
      cards: manifest.foundation.cards.map((card) => ({
        id: card.id,
        citeKey: card.citeKey,
        cardType: card.cardType,
        title: card.title,
        document: ref(card.document)
      }))
    },
    frameworkStages: manifest.frameworkStages.map((stage) => ({ ...stage })),
    chapters: manifest.manuscript.chapters.map(ref),
    sections: manifest.manuscript.sections.map((section) => ({
      id: section.id,
      ...(section.chapterId ? { chapterId: section.chapterId } : {}),
      title: section.title,
      wordCountRequirement: section.wordCountRequirement,
      brief: ref(section.brief),
      body: ref(section.body),
      state: ref(section.state)
    })),
    counts
  };
}

export async function queryWritingWorkspace(
  manifest: BookProjectManifest,
  query: WritingReadQuery,
  runId: string,
  readMarkdown: (path: string) => Promise<string>,
  fileCounts: (path: string) => Promise<WritingMetrics>
): Promise<
  WritingIndex | AcademicWritingIndex | WritingFile | WritingSearchResult
> {
  if (manifest.bookType === "academic") {
    return queryAcademicWritingWorkspace(
      manifest,
      query,
      readMarkdown,
      fileCounts
    );
  }
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
  const parsedBook =
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
  if (parsedBook.bookType === "academic") {
    throw new Error("Unexpected academic book in creative workspace reader.");
  }
  const book = parsedBook;
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
  if (query.mode === "search") {
    const targets: SearchTarget[] = [
      ...book.documents
        .filter((doc) => settings.has(doc.id))
        .map((doc): SearchTarget => ({
          kind: "document",
          objectId: doc.id,
          documentId: doc.id,
          title: doc.title,
          path: paths.get(doc.id),
          inlineContent: "content" in doc ? doc.content : undefined
        })),
      ...book.draft.sections.flatMap((section): SearchTarget[] => [
        {
          kind: "draft_body",
          objectId: section.id,
          documentId: section.body.id,
          title: section.title,
          path: paths.get(section.body.id),
          inlineContent:
            "content" in section.body ? section.body.content : undefined
        },
        {
          kind: "draft_state",
          objectId: section.id,
          documentId: section.characterState.id,
          title: section.characterState.title,
          path: paths.get(section.characterState.id),
          inlineContent:
            "content" in section.characterState
              ? section.characterState.content
              : undefined
        }
      ])
    ];
    return executeWritingSearch(
      targets,
      query.query,
      query.limit,
      readMarkdown
    );
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
