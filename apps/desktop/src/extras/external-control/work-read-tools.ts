import {
  CatalogIndexSnapshotSchema,
  CatalogReadDocumentResultSchema,
  LongBookIdSchema,
  LongListBooksResultSchema,
  LongReadDocumentResultSchema,
  LongWorkspaceIndexResultSchema,
  MysteryDocumentTargetSchema,
  MysteryListBooksResultSchema,
  MysteryReadAgentsMdResultSchema,
  MysteryReadDocumentResultSchema,
  MysteryWorkspaceIndexResultSchema,
  listLongWorkspaceFiles,
  longLedgerCommitChapterIds,
  mysteryDocumentRelativePath,
  mysteryDocumentTargetKey,
  type CatalogIndexBook,
  type CatalogIndexSnapshot,
  type LongBookMetadata,
  type MysteryBookSummary,
  type MysteryDocumentTarget,
  type MysteryWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  EXTERNAL_DEFAULT_PAGE_CHARACTERS,
  ExternalDocumentPageSchema,
  ExternalListWorksResultSchema,
  ExternalWorkDetailSchema,
  type ExternalGetWorkInput,
  type ExternalListWorksInput,
  type ExternalReadDocumentInput
} from "@deepwrite/contracts/external-control";
import { readCore, type CoreRequest } from "./core-client";
import { pageText } from "./document-page";
import { ExternalControlError } from "./errors";

const DOCUMENT_NOT_FOUND = "找不到这个文档。请用 get_work 重新确认文档 ID。";

export function isLongWorkId(id: string): boolean {
  return LongBookIdSchema.safeParse(id).success;
}

export function isMysteryWorkId(id: string): boolean {
  return /^mys[-_]/u.test(id);
}

export function parseMysteryDocumentTargetKey(
  documentId: string
): MysteryDocumentTarget {
  const parts = documentId.split(":");
  let candidate: unknown;
  if (documentId === "agents_md") {
    candidate = { kind: "agents_md" };
  } else if (documentId === "character_relations") {
    candidate = { kind: "character_relations" };
  } else if (documentId === "dm_manual") {
    candidate = { kind: "dm_manual" };
  } else if (parts[0] === "truth_doc" && parts.length === 2) {
    candidate = { kind: "truth_doc", docId: parts[1] };
  } else if (parts[0] === "role" && parts.length === 3) {
    candidate = { kind: "role", roleId: parts[1], document: parts[2] };
  } else if (parts[0] === "player_act" && parts.length === 4) {
    candidate = {
      kind: "player_act",
      roleId: parts[1],
      actId: parts[2],
      document: parts[3]
    };
  } else if (parts[0] === "clue_round" && parts.length === 2) {
    candidate = { kind: "clue_round", roundId: parts[1] };
  } else if (parts[0] === "public_doc" && parts.length === 2) {
    candidate = { kind: "public_doc", docId: parts[1] };
  }
  const parsed = MysteryDocumentTargetSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ExternalControlError(
      "external.invalid_input",
      "找不到这个剧本杀文档 ID。请用 get_work 重新确认 documentId。"
    );
  }
  return parsed.data;
}

export function readCatalogIndex(
  core: CoreRequest
): Promise<CatalogIndexSnapshot> {
  return readCore(core, "catalog.index", {}, CatalogIndexSnapshotSchema);
}

function workNotFound(): ExternalControlError {
  return new ExternalControlError(
    "external.not_found",
    "找不到这部作品。请用 list_works 重新确认作品 ID。"
  );
}

function summary(work: CatalogIndexBook | LongBookMetadata) {
  return {
    id: work.id,
    type: work.bookType,
    title: work.title,
    genre: work.bookType === "academic" ? work.subtype : work.genre,
    ...(work.bookType === "academic"
      ? {
          subtype: work.subtype,
          citationStyle: work.citationStyle
        }
      : {}),
    status: work.status,
    updatedAt: work.updatedAt
  };
}

function mysterySummary(work: MysteryBookSummary) {
  return {
    id: work.id,
    type: "mystery" as const,
    title: work.title,
    genre: work.genre,
    status: work.status,
    updatedAt: work.updatedAt
  };
}

function linkedIds(idsByKind: Record<string, readonly string[] | undefined>) {
  return [...new Set(Object.values(idsByKind).flatMap((ids) => ids ?? []))];
}

function linkedLibraries(work: CatalogIndexBook | LongBookMetadata) {
  if (work.bookType === "academic") {
    return {
      linkedMaterialLibraryIds: [...work.linkedMaterialIds],
      linkedSkillLibraryIds: [...work.linkedSkillIds]
    };
  }
  return {
    linkedMaterialLibraryIds: linkedIds(work.linkedMaterialIdsByKind),
    linkedSkillLibraryIds: linkedIds(work.linkedSkillIdsByKind)
  };
}

export async function listWorks(
  core: CoreRequest,
  input: ExternalListWorksInput
) {
  const [index, long, mystery] = await Promise.all([
    readCatalogIndex(core),
    readCore(core, "long.list", {}, LongListBooksResultSchema),
    readCore(core, "mystery.list", {}, MysteryListBooksResultSchema)
  ]);
  const works = [
    ...[...index.books, ...long.books].map(summary),
    ...mystery.books.map(mysterySummary)
  ].filter((work) => !input.type || work.type === input.type);
  return ExternalListWorksResultSchema.parse({
    works,
    unavailableWorkIds: [
      ...(index.projectDiagnostics ?? [])
        .filter(({ kind }) => kind === "deepwrite.book")
        .map(({ projectId }) => projectId),
      ...(long.diagnostics ?? []).map(({ bookId }) => bookId),
      ...(mystery.diagnostics ?? []).map(({ bookId }) => bookId)
    ]
  });
}

function isReferencesTitle(title: string): boolean {
  const normalized = title.trim().toLocaleLowerCase();
  return (
    normalized === "参考文献" ||
    normalized === "references" ||
    normalized === "bibliography"
  );
}

function orderedAcademicSections(
  book: Extract<CatalogIndexBook, { bookType: "academic" }>
) {
  const { chapters, sections } = book.manuscript;
  if (chapters.length === 0) return sections;
  const byChapter = new Map<string, typeof sections>();
  for (const chapter of chapters) byChapter.set(chapter.id, []);
  const leading: typeof sections = [];
  const trailing: typeof sections = [];
  const firstChapteredIndex = sections.findIndex((s) =>
    Boolean(s.chapterId && byChapter.has(s.chapterId))
  );
  sections.forEach((section, index) => {
    if (section.chapterId && byChapter.has(section.chapterId)) {
      byChapter.get(section.chapterId)!.push(section);
    } else if (firstChapteredIndex >= 0) {
      if (index < firstChapteredIndex) leading.push(section);
      else trailing.push(section);
    } else if (isReferencesTitle(section.title)) {
      trailing.push(section);
    } else {
      leading.push(section);
    }
  });
  return [
    ...leading,
    ...chapters.flatMap((chapter) => byChapter.get(chapter.id) ?? []),
    ...trailing
  ];
}

export function mysteryWorkDocuments(index: MysteryWorkspaceIndexSnapshot) {
  const cellMap = new Map(
    index.actMatrix.map((cell) => [`${cell.roleId}:${cell.actId}`, cell])
  );
  return [
    {
      id: mysteryDocumentTargetKey({ kind: "agents_md" }),
      title: "AGENTS.md",
      group: "truth",
      bytes: index.agentsMdChars,
      updatedAt: index.updatedAt
    },
    ...index.truthDocuments.map((doc) => ({
      id: mysteryDocumentTargetKey({ kind: "truth_doc", docId: doc.id }),
      title: doc.title,
      group: "truth",
      bytes: doc.charCount,
      updatedAt: index.updatedAt
    })),
    {
      id: mysteryDocumentTargetKey({ kind: "character_relations" }),
      title: "人物关系网",
      group: "characters",
      bytes: index.characterRelations.charCount,
      updatedAt: index.characterRelations.updatedAt
    },
    ...index.roles.flatMap((role) => [
      {
        id: mysteryDocumentTargetKey({
          kind: "role",
          roleId: role.id,
          document: "profile"
        }),
        title: `${role.name} · 秘密设定`,
        group: "characters",
        bytes: role.profileChars,
        updatedAt: index.updatedAt
      },
      {
        id: mysteryDocumentTargetKey({
          kind: "role",
          roleId: role.id,
          document: "pitch"
        }),
        title: `${role.name} · 公开介绍`,
        group: "characters",
        bytes: role.pitchChars,
        updatedAt: index.updatedAt
      }
    ]),
    ...index.acts.flatMap((act) =>
      index.roles.flatMap((role) => {
        const cell = cellMap.get(`${role.id}:${act.id}`);
        return [
          {
            id: mysteryDocumentTargetKey({
              kind: "player_act",
              roleId: role.id,
              actId: act.id,
              document: "brief"
            }),
            title: `${role.name} / ${act.title} · 视角提纲`,
            group: "scripts",
            bytes: cell?.briefChars ?? 0,
            updatedAt: index.updatedAt
          },
          {
            id: mysteryDocumentTargetKey({
              kind: "player_act",
              roleId: role.id,
              actId: act.id,
              document: "body"
            }),
            title: `${role.name} / ${act.title} · 玩家剧本`,
            group: "scripts",
            bytes: cell?.bodyChars ?? 0,
            updatedAt: index.updatedAt
          }
        ];
      })
    ),
    {
      id: mysteryDocumentTargetKey({
        kind: "public_doc",
        docId: "public_openings"
      }),
      title: "公开开场",
      group: "clues",
      bytes: index.publicOpenings.charCount,
      updatedAt: index.publicOpenings.updatedAt
    },
    ...index.clueRounds.map((round) => ({
      id: mysteryDocumentTargetKey({ kind: "clue_round", roundId: round.id }),
      title: round.title,
      group: "clues",
      bytes: round.charCount,
      updatedAt: index.updatedAt
    })),
    {
      id: mysteryDocumentTargetKey({ kind: "public_doc", docId: "endings" }),
      title: "结局真相",
      group: "clues",
      bytes: index.endings.charCount,
      updatedAt: index.endings.updatedAt
    },
    {
      id: mysteryDocumentTargetKey({ kind: "dm_manual" }),
      title: "DM 主持手册",
      group: "dm",
      bytes: index.dmManual.charCount,
      updatedAt: index.dmManual.updatedAt
    }
  ];
}

/** Every readable text of a catalog work, in reading order. */
export function catalogWorkDocuments(book: CatalogIndexBook) {
  if (book.bookType === "academic") {
    const docById = new Map(
      book.documents.map((doc) => [doc.id, doc] as const)
    );
    const seenDocIds = new Set<string>();
    const orderedStageDocs = book.frameworkStages.flatMap((stage) => {
      const doc = docById.get(stage.id);
      if (!doc) return [];
      seenDocIds.add(doc.id);
      return [doc];
    });
    for (const doc of book.documents) {
      if (!seenDocIds.has(doc.id)) orderedStageDocs.push(doc);
    }
    const orderedSections = orderedAcademicSections(book);
    return [
      {
        id: book.foundation.thesisOverview.id,
        title: book.foundation.thesisOverview.title,
        group: "foundation",
        bytes: book.foundation.thesisOverview.contentBytes,
        updatedAt: book.foundation.thesisOverview.updatedAt
      },
      {
        id: book.foundation.terminology.id,
        title: book.foundation.terminology.title,
        group: "foundation",
        bytes: book.foundation.terminology.contentBytes,
        updatedAt: book.foundation.terminology.updatedAt
      },
      ...book.foundation.cards.map((card) => ({
        id: card.document.id,
        title: `[${card.citeKey}] ${card.title}`,
        group: "reference_card",
        bytes: card.document.contentBytes,
        updatedAt: card.document.updatedAt
      })),
      ...orderedStageDocs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        group: "framework",
        bytes: doc.contentBytes,
        updatedAt: doc.updatedAt
      })),
      ...orderedSections.flatMap((section) => [
        {
          id: section.brief.id,
          title: section.brief.title,
          group: "manuscript",
          bytes: section.brief.contentBytes,
          updatedAt: section.brief.updatedAt
        },
        {
          id: section.body.id,
          title: `${section.title} · 正文`,
          group: "manuscript",
          bytes: section.body.contentBytes,
          updatedAt: section.body.updatedAt
        },
        {
          id: section.state.id,
          title: section.state.title,
          group: "manuscript",
          bytes: section.state.contentBytes,
          updatedAt: section.state.updatedAt
        }
      ])
    ];
  }
  const stageIds = new Set(book.plotStages.map(({ id }) => id));
  return [
    ...book.documents.map((document) => ({
      id: document.id,
      title: document.title,
      group: stageIds.has(document.id) ? "stage" : "document",
      bytes: document.contentBytes,
      updatedAt: document.updatedAt
    })),
    ...book.draft.sections.flatMap((section) => [
      {
        id: section.body.id,
        title: `${section.title} · 正文`,
        group: "draft",
        bytes: section.body.contentBytes,
        updatedAt: section.body.updatedAt
      },
      {
        id: section.characterState.id,
        title: `${section.title} · 状态`,
        group: "draft",
        bytes: section.characterState.contentBytes,
        updatedAt: section.characterState.updatedAt
      }
    ])
  ];
}

async function longMetadata(
  core: CoreRequest,
  bookId: string,
  metadata: LongBookMetadata | undefined
): Promise<LongBookMetadata> {
  if (metadata) return metadata;
  const { books } = await readCore(
    core,
    "long.list",
    {},
    LongListBooksResultSchema
  );
  const found = books.find(({ id }) => id === bookId);
  if (!found) throw workNotFound();
  return found;
}

async function getLongWork(core: CoreRequest, bookId: string) {
  const { workspaceIndex, metadata } = await readCore(
    core,
    "long.getWorkspaceIndex",
    { bookId },
    LongWorkspaceIndexResultSchema,
    "找不到这部作品。请用 list_works 重新确认作品 ID。"
  );
  const book = await longMetadata(core, bookId, metadata);
  return ExternalWorkDetailSchema.parse({
    ...summary(book),
    documents: listLongWorkspaceFiles(workspaceIndex).map(
      ({ file, root, title }) => ({
        id: file.id,
        title,
        group: root,
        updatedAt: file.updatedAt
      })
    ),
    continuity: workspaceIndex.ledger.commits.map((commit) => ({
      commitId: commit.id,
      chapterCardIds: longLedgerCommitChapterIds(commit),
      status: !commit.bodyEvidence
        ? "unverified"
        : commit.changedChapterIds?.length
          ? "needs_review"
          : "current",
      changedChapterIds: commit.changedChapterIds ?? []
    })),
    ...linkedLibraries(book)
  });
}

async function getMysteryWork(core: CoreRequest, bookId: string) {
  const [{ workspaceIndex }, list] = await Promise.all([
    readCore(
      core,
      "mystery.getWorkspaceIndex",
      { bookId },
      MysteryWorkspaceIndexResultSchema,
      "找不到这部作品。请用 list_works 重新确认作品 ID。"
    ),
    readCore(core, "mystery.list", {}, MysteryListBooksResultSchema)
  ]);
  const book = list.books.find(({ id }) => id === bookId);
  if (!book) throw workNotFound();
  return ExternalWorkDetailSchema.parse({
    ...mysterySummary(book),
    stages: [
      { id: "truth", title: "真相与统筹", enabled: true },
      { id: "characters", title: "角色与选角", enabled: true },
      { id: "scripts", title: "分幕人物本", enabled: true },
      { id: "clues", title: "线索与结局", enabled: true },
      { id: "dm", title: "DM 主持手册", enabled: true }
    ],
    documents: mysteryWorkDocuments(workspaceIndex),
    linkedMaterialLibraryIds: book.linkedMaterialIds,
    linkedSkillLibraryIds: book.linkedSkillIds
  });
}

export async function getWork(core: CoreRequest, input: ExternalGetWorkInput) {
  if (isLongWorkId(input.workId)) return getLongWork(core, input.workId);
  if (isMysteryWorkId(input.workId)) return getMysteryWork(core, input.workId);
  const index = await readCatalogIndex(core);
  const book = index.books.find(({ id }) => id === input.workId);
  if (!book) throw workNotFound();
  const stages =
    book.bookType === "academic" ? book.frameworkStages : book.plotStages;
  return ExternalWorkDetailSchema.parse({
    ...summary(book),
    stages: stages.map(({ id, title, enabled }) => ({
      id,
      title,
      enabled
    })),
    ...(book.bookType === "academic"
      ? {
          chapters: book.manuscript.chapters.map((chapter) => ({
            id: chapter.id,
            title: chapter.title,
            sectionIds: book.manuscript.sections
              .filter((section) => section.chapterId === chapter.id)
              .map((section) => section.id)
          }))
        }
      : {}),
    documents: catalogWorkDocuments(book),
    ...linkedLibraries(book)
  });
}

export async function readDocument(
  core: CoreRequest,
  input: ExternalReadDocumentInput
) {
  const { workId, documentId } = input;
  if (isMysteryWorkId(workId)) {
    const target = parseMysteryDocumentTargetKey(documentId);
    const title = mysteryDocumentRelativePath(target);
    if (target.kind === "agents_md") {
      const agents = await readCore(
        core,
        "mystery.readAgentsMd",
        { bookId: workId },
        MysteryReadAgentsMdResultSchema,
        DOCUMENT_NOT_FOUND
      );
      return ExternalDocumentPageSchema.parse({
        workId,
        documentId,
        title,
        revision: agents.revision,
        ...pageText(agents.content, input.offset, input.maxCharacters)
      });
    }
    const page = await readCore(
      core,
      "mystery.readDocument",
      {
        bookId: workId,
        target,
        offset: input.offset ?? 0,
        limit: input.maxCharacters ?? EXTERNAL_DEFAULT_PAGE_CHARACTERS
      },
      MysteryReadDocumentResultSchema,
      DOCUMENT_NOT_FOUND
    );
    const readCount = Array.from(page.content).length;
    return ExternalDocumentPageSchema.parse({
      workId,
      documentId,
      title,
      content: page.content,
      offset: page.offset,
      totalCharacters: page.totalCharacters,
      nextOffset: page.hasMore ? page.offset + readCount : null,
      revision: page.revision
    });
  }
  if (isLongWorkId(workId)) {
    const [page, { workspaceIndex }] = await Promise.all([
      readCore(
        core,
        "long.readDocument",
        {
          bookId: workId,
          fileId: documentId,
          offset: input.offset ?? 0,
          maxCharacters: input.maxCharacters ?? EXTERNAL_DEFAULT_PAGE_CHARACTERS
        },
        LongReadDocumentResultSchema,
        DOCUMENT_NOT_FOUND
      ),
      readCore(
        core,
        "long.getWorkspaceIndex",
        { bookId: workId },
        LongWorkspaceIndexResultSchema,
        DOCUMENT_NOT_FOUND
      )
    ]);
    const indexed = listLongWorkspaceFiles(workspaceIndex).find(
      ({ file }) => file.id === page.file.id
    );
    return ExternalDocumentPageSchema.parse({
      workId,
      documentId,
      title: indexed?.title ?? page.file.path,
      content: page.content,
      offset: page.offset,
      totalCharacters: page.totalCharacters,
      nextOffset: page.nextOffset,
      revision: page.file.updatedAt
    });
  }
  const document = await readCore(
    core,
    "catalog.readDocument",
    { projectId: workId, target: "document", documentId },
    CatalogReadDocumentResultSchema,
    DOCUMENT_NOT_FOUND
  );
  return ExternalDocumentPageSchema.parse({
    workId,
    documentId,
    title: document.title,
    revision: document.revision,
    ...pageText(document.content, input.offset, input.maxCharacters)
  });
}
