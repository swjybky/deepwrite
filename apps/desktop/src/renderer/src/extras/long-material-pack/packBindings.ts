import {
  flattenMaterialIdsByKind,
  materialIdsToByKind,
  type DeepWriteApi,
  type LinkedMaterialIdsByKind,
  type LinkedSkillIdsByKind
} from "@deepwrite/contracts/renderer";

export interface PackWork {
  key: string;
  kind: "short" | "script" | "long" | "academic";
  id: string;
  title: string;
  /** Long books replace all links at once and must resend their skills. */
  skills?: LinkedSkillIdsByKind;
}

export async function listPackWorks(api: DeepWriteApi): Promise<PackWork[]> {
  const [index, longs] = await Promise.all([
    api.catalog.index(),
    api.long.list()
  ]);
  return [
    ...longs.books.map((book) => ({
      key: `long:${book.id}`,
      kind: "long" as const,
      id: book.id,
      title: book.title,
      skills: book.linkedSkillIdsByKind
    })),
    ...index.books.map((book) => ({
      key: `${book.bookType}:${book.id}`,
      kind: book.bookType,
      id: book.id,
      title: book.title
    }))
  ];
}

/** The group's five libraries, one per kind, as the group binding mode does. */
export async function packGroupLinks(
  api: DeepWriteApi,
  groupId: string
): Promise<LinkedMaterialIdsByKind> {
  const index = await api.catalog.index();
  const group = index.materialGroups.find(({ id }) => id === groupId);
  if (!group) throw new Error(groupId);
  return materialIdsToByKind(group.memberIds, index.materials);
}

export async function bindPackToWork(
  api: DeepWriteApi,
  work: PackWork,
  links: LinkedMaterialIdsByKind
): Promise<void> {
  if (work.kind === "long")
    await api.long.updateBindings({
      bookId: work.id,
      linkedMaterialIdsByKind: links,
      linkedSkillIdsByKind: work.skills ?? {}
    });
  else if (work.kind === "academic")
    await api.catalog.updateBook({
      bookId: work.id,
      linkedMaterialIds: flattenMaterialIdsByKind(links)
    });
  else
    await api.catalog.updateBook({
      bookId: work.id,
      linkedMaterialIdsByKind: links
    });
}

export async function createImitationBook(
  api: DeepWriteApi,
  input: { title: string; genre: string; links: LinkedMaterialIdsByKind }
): Promise<string | null> {
  const created = await api.long.create({
    title: input.title,
    genre: input.genre,
    linkedMaterialIdsByKind: input.links
  });
  return created?.book.id ?? null;
}
