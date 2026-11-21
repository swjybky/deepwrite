import { createScopedTranslator } from "../i18n";
import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import { createLongChapterSelection } from "../types/longWorkspace";
import type { LongChapterLookup } from "../types/longIndexedChapter";

const t = createScopedTranslator("workspace");

type LongNavigationChapter =
  LongBookSummary["navigation"]["chapterCards"][number];
type LongNavigationVolume = LongBookSummary["navigation"]["volumes"][number];

function chapterStatusBadge(
  chapter: LongNavigationChapter,
  index?: LongWorkspaceIndexSnapshot | null,
  lookup?: LongChapterLookup
): string {
  const files = lookup
    ? lookup.entries.get(chapter.id)
    : index?.chapters.find(({ chapterCardId }) => chapterCardId === chapter.id);
  if (files && files.commitId !== null)
    return t("longWorkspaceDraftTree.completed");
  return (files?.bodyStatus ?? chapter.bodyStatus) === "written"
    ? t("longWorkspaceDraftTree.pendingCommit")
    : t("longWorkspaceDraftTree.notWritten");
}

export function projectLongWorkspaceDraftTree(input: {
  book: LongBookSummary;
  index?: LongWorkspaceIndexSnapshot | null;
  volumes: LongNavigationVolume[];
  chaptersByVolume: ReadonlyMap<string, LongNavigationChapter[]>;
  nodeId: (key: string) => string;
  lookup?: LongChapterLookup | undefined;
  recordedVolumeIds?: ReadonlySet<string> | undefined;
}): ResourceTreeNode[] {
  return input.volumes.map<ResourceTreeNode>((volume) => {
    const chapters = (
      input.chaptersByVolume.get(volume.id) ?? []
    ).flatMap<ResourceTreeNode>((chapter) => {
      const files = input.lookup
        ? input.lookup.entries.get(chapter.id)
        : input.index?.chapters.find(
            ({ chapterCardId }) => chapterCardId === chapter.id
          );
      const recorded = Boolean(files && files.commitId !== null);
      const selection = input.index
        ? createLongChapterSelection(
            input.book,
            input.index,
            chapter.id,
            input.lookup
          )
        : {
            key: `chapter:${chapter.id}`,
            root: "draft" as const,
            chapterCardId: chapter.id,
            title: chapter.title,
            breadcrumbs: [
              input.book.title,
              t("catalogWorkspace.manuscript"),
              volume.title,
              chapter.title
            ],
            files: [],
            preferredRole: "body" as const
          };
      return selection
        ? [
            {
              id: input.nodeId(selection.key),
              label: selection.title,
              icon: "edit",
              badge: chapterStatusBadge(chapter, input.index, input.lookup),
              workspaceType: "long",
              longBookId: input.book.id,
              catalogNodeType: "category",
              longWorkspaceSelection: selection,
              selectableBranch: false,
              ...(recorded ? { longDraftChapterRecorded: true } : {})
            }
          ]
        : [];
    });
    return {
      id: input.nodeId(`volume:${volume.id}`),
      label: volume.title,
      icon: "folder",
      badge: t("longWorkspaceResourceTree.chapters", {
        length: chapters.length
      }),
      workspaceType: "long",
      longBookId: input.book.id,
      catalogNodeType: "category",
      longDraftVolumeId: volume.id,
      ...(input.recordedVolumeIds?.has(volume.id)
        ? { longVolumeHasRecordedChapters: true }
        : {}),
      ...(chapters.length ? { children: chapters } : {})
    };
  });
}
