import treeNodeFactorySource from "../utils/longWorkspaceTreeNode.ts?raw";
import continuityTreeSource from "../utils/longWorkspaceContinuityTree.ts?raw";
import {
  appSource,
  chapterCardDialogSource,
  characterDialogSource,
  characterNavigationSource,
  describe,
  dialogCoordinatorSource,
  dialogSource,
  editorDeleteDialogsSource,
  editorSessionSource,
  editorSource,
  editorStructureSource,
  expect,
  foreshadowingFiltersSource,
  it,
  leftSidebarSource,
  longStructureTransactionsSource,
  longWorkspaceDraftTreeSource,
  longWorkspaceResourceTreeSource,
  longWorkspaceTypeSource,
  manuscriptNavigationSource,
  plotPointDialogSource,
  sectionSource,
  treeNodeSource,
  workspaceDialogLayerSource,
  worldbuildingNavigationSource
} from "./LongWorkspace.test-support";

describe("long-form renderer vertical slice: navigation-and-characters", () => {
  it("keeps create-book loading feedback inside the stable action footer", () => {
    const actionsStart = dialogSource.indexOf(
      '<div class="dialog-actions create-short-book-actions">'
    );
    const statusStart = dialogSource.indexOf(
      'class="dialog-action-status"',
      actionsStart
    );
    const cancelStart = dialogSource.indexOf(
      'class="dialog-secondary-button"',
      actionsStart
    );

    expect(actionsStart).toBeGreaterThan(-1);
    expect(statusStart).toBeGreaterThan(actionsStart);
    expect(statusStart).toBeLessThan(cancelStart);
    expect(dialogSource).not.toContain(
      '<p v-if="loading" class="create-short-stable-hint"'
    );
  });

  it("projects one foreshadowing data source into overview, volume, and plot-point views", () => {
    expect(longWorkspaceResourceTreeSource).toContain(
      'key: "plot-design:foreshadowing"'
    );
    expect(longWorkspaceResourceTreeSource).toContain(
      "book.navigation.counts.foreshadowingThreads"
    );
    expect(longWorkspaceTypeSource).toContain(
      'selection.key === "plot-design:foreshadowing"'
    );
    expect(editorSource).toContain("<LongForeshadowingWorkspace");
    expect(editorSource).toContain("currentIsForeshadowingWorkspace");
    expect(editorSource).toContain("currentIsVolumeForeshadowing");
    expect(editorSource).toContain("currentIsPlotPointForeshadowing");
    expect(editorSource).toContain("本卷伏笔");
    expect(editorSource).toContain("伏笔触点");
    expect(editorSource).toContain('@mutation="forwardForeshadowingMutation"');
    expect(editorStructureSource).toContain('if (tab === "foreshadowing")');
    expect(editorStructureSource).toContain(
      "if (!props.locked && !(await saveAllChanges())) return;"
    );
    expect(editorSource).toContain(
      "if (currentIsPlotPointForeshadowing.value)"
    );
    expect(appSource).toContain(
      '@mutation="handleActiveLongStructureMutation"'
    );
    expect(foreshadowingFiltersSource).toContain(
      '"overview" | "volume" | "plotPoint"'
    );
  });

  it("offers long-book creation in the unified themed creation dialog", () => {
    expect(leftSidebarSource).toContain('label: "新建书籍"');
    expect(leftSidebarSource).toContain('emit("createBook")');
    expect(appSource).toContain('@create-book="openCreateBookDialog"');
    expect(appSource).toContain("function openCreateBookDialog(): void {");
    expect(appSource).toContain("createBookDialogOpen.value = true");
    expect(sectionSource).toContain('"新建作品"');
    expect(sectionSource).not.toContain('id: "create-long-book"');
    expect(dialogSource).toContain('role="tablist"');
    expect(dialogSource).toContain('label: "长篇"');
    expect(dialogSource).toContain("<PopupSelect");
    expect(dialogSource).not.toContain("<select");
    expect(dialogSource).toContain("uiMessage.warning");
    expect(dialogSource).toContain('<Teleport to="body">');
    expect(dialogSource).toContain("linkedMaterialIdsByKind");
    expect(dialogSource).toContain("linkedSkillIdsByKind");
    expect(dialogSource).toContain('workspaceType.value === "long"');
  });

  it("renders all five long-workspace roots from the navigation summary", () => {
    for (const root of [
      "worldbuilding",
      "character_design",
      "plot_design",
      "draft",
      "continuity_ledger"
    ]) {
      expect(longWorkspaceResourceTreeSource).toContain(`${root}:`);
    }
    expect(longWorkspaceResourceTreeSource).toContain("book.navigation.counts");
    expect(continuityTreeSource).toContain("index.ledger.commits");
    expect(longWorkspaceTypeSource).toContain(
      "isLongMigrationEvidenceCategoryId"
    );
    expect(longWorkspaceTypeSource).toContain("{ readOnly: true }");
    expect(longWorkspaceTypeSource).toContain('role: "body"');
    expect(longWorkspaceTypeSource).toContain('role: "character-state"');
    expect(longWorkspaceTypeSource).toContain('role: "handoff"');
  });

  it("groups characters by each book's dynamic type directory with tab-bar creation", () => {
    expect(longWorkspaceTypeSource).toContain("DEFAULT_LONG_CHARACTER_TYPES");
    expect(longWorkspaceResourceTreeSource).toContain(
      "const characterGroupChildren = [...book.navigation.characterTypes]"
    );
    expect(longWorkspaceResourceTreeSource).toContain(
      'key: "character-overview"'
    );
    expect(longWorkspaceResourceTreeSource).toContain(
      "characterCountByGroup.get(character.group)"
    );
    expect(longWorkspaceResourceTreeSource).toContain(
      "longCharacterGroup: group.id"
    );
    expect(treeNodeFactorySource).toContain(
      "label: options.label ?? selection.title"
    );
    expect(longWorkspaceResourceTreeSource).toContain("label: group.title");
    const characterProjection = longWorkspaceResourceTreeSource.slice(
      longWorkspaceResourceTreeSource.indexOf(
        "const characterGroupChildren = [...book.navigation.characterTypes]"
      ),
      longWorkspaceResourceTreeSource.indexOf("const bookLineSelection")
    );
    expect(characterProjection).not.toContain(
      "key: `character:${character.id}`"
    );
    expect(characterProjection).not.toContain("children: characters");
    expect(treeNodeSource).not.toContain("createLongCharacter");
    expect(editorSource).toContain("currentIsCharacterGroup");
    expect(characterNavigationSource).toContain('aria-label="新增人物"');
    expect(characterNavigationSource).toContain('aria-label="删除当前人物"');
    expect(editorSource).toContain('aria-label="删除当前分卷"');
    expect(editorSource).toContain('aria-label="删除当前剧情点"');
    expect(manuscriptNavigationSource).toContain('aria-label="删除当前章卡"');
    expect(worldbuildingNavigationSource).toContain(
      'aria-label="删除当前世界观条目"'
    );
    expect(editorSource).toContain('<AppIcon name="minus" :size="15" />');
    expect(editorDeleteDialogsSource).toContain('role="alertdialog"');
    expect(editorSource).toContain(
      'emit("deleteStructure", input, completion)'
    );
    expect(appSource).toContain(
      '@delete-structure="deleteActiveLongNavigationStructure"'
    );
    expect(longStructureTransactionsSource).toContain(
      "builder.deleteCharacter(target.id)"
    );
    expect(longStructureTransactionsSource).toContain(
      "builder.deleteVolume(target.id)"
    );
    expect(longStructureTransactionsSource).toContain(
      "builder.deleteArc(target.id)"
    );
    expect(longStructureTransactionsSource).toContain(
      "builder.deleteChapter(target.id)"
    );
    expect(longStructureTransactionsSource).toContain(
      "expectedImpact: pending.expectedImpact"
    );
    expect(longStructureTransactionsSource).toContain(
      "onImpactChanged: (expectedImpact) =>"
    );
    expect(editorSource).toContain("emit('createCharacter')");
    expect(editorStructureSource).toContain('emit("createWorldbuildingItem")');
    expect(editorSource).toContain("currentEmptyCollection");
    expect(editorSource).toContain("还没有${selection.title}");
    expect(editorSource).toContain("新建第一个人物");
    expect(editorSource).toContain("新建第一个剧情点");
    expect(editorSource).toContain("新建第一张章卡");
    expect(editorSource).toContain('@click="createFirstCollectionItem"');
    expect(appSource).toContain('@create-character="openLongCharacterCreate"');
    expect(appSource).toContain(
      '@create-worldbuilding-item="openLongWorldbuildingItemCreate"'
    );
    expect(longWorkspaceResourceTreeSource).toContain(
      'plot_design: "剧情设计"'
    );
    expect(longWorkspaceResourceTreeSource).toContain(
      'key: "root:plot-points"'
    );
    expect(longWorkspaceResourceTreeSource).toContain(
      "const plotPointVolumeChildren: ResourceTreeNode[]"
    );
    expect(longWorkspaceResourceTreeSource).toContain(
      "key: `plot-design:plot-points:${volume.id}`"
    );
    expect(longWorkspaceResourceTreeSource).toContain("label: volume.title");
    expect(longWorkspaceResourceTreeSource).toContain('title: "剧情点"');
    expect(longWorkspaceResourceTreeSource).toContain('title: "章卡"');
    expect(longWorkspaceResourceTreeSource).toContain('label: "正文"');
    const chapterCardProjection = longWorkspaceResourceTreeSource.slice(
      longWorkspaceResourceTreeSource.indexOf(
        "const chapterCardManagementChildren: ResourceTreeNode[]"
      ),
      longWorkspaceResourceTreeSource.indexOf(
        "const plotChildren: ResourceTreeNode[]"
      )
    );
    expect(chapterCardProjection).toContain(
      "key: `plot-design:chapter-cards:${volume.id}`"
    );
    expect(chapterCardProjection).toContain("chapterCardTabs:");
    expect(chapterCardProjection).not.toContain(
      "root:chapter-card-management:"
    );
    expect(chapterCardProjection).not.toContain("children: chapters");
    const plotChildrenProjection = longWorkspaceResourceTreeSource.slice(
      longWorkspaceResourceTreeSource.indexOf(
        "const plotChildren: ResourceTreeNode[]"
      ),
      longWorkspaceResourceTreeSource.indexOf("const draftChildren")
    );
    const plotPointsPosition = plotChildrenProjection.indexOf(
      'key: "root:plot-points"'
    );
    const foreshadowingPosition = plotChildrenProjection.indexOf(
      "node(foreshadowingSelection"
    );
    expect(plotPointsPosition).toBeGreaterThan(-1);
    expect(foreshadowingPosition).toBeGreaterThan(-1);
    expect(plotPointsPosition).toBeLessThan(foreshadowingPosition);
    expect(plotChildrenProjection).not.toContain('key: "root:plot-volumes"');
    expect(plotChildrenProjection).not.toContain(
      "key: `root:plot-arc:${arc.id}`"
    );
    expect(
      plotChildrenProjection.indexOf('key: "root:plot-points"')
    ).toBeLessThan(
      plotChildrenProjection.indexOf('key: "root:plot-chapter-cards"')
    );
    const longRootProjection = longWorkspaceResourceTreeSource.slice(
      longWorkspaceResourceTreeSource.indexOf(
        "const counts = book.navigation.counts;"
      )
    );
    expect(
      longRootProjection.match(/node\(createLongRootSelection/gu)
    ).toHaveLength(5);
    expect(longRootProjection).not.toContain('title: "章卡"');
    expect(editorSource).toContain("全书总纲");
    expect(editorSource).toContain("orderedBookLineVolumes");
    expect(editorSource).toContain("currentIsPlotPointWorkspace");
    expect(editorSource).toContain("selection.plotPointTabs");
    expect(editorSource).toContain("emit('selectPlotPoint', plotPoint.id)");
    expect(editorSource).toContain("currentIsChapterCardWorkspace");
    expect(editorSource).toContain("selection.chapterCardTabs");
    expect(manuscriptNavigationSource).toContain(
      "emit('selectChapter', chapter.id)"
    );
    expect(appSource).toContain(
      '@select-chapter-card="selectLongChapterCardTab"'
    );
    expect(editorSource).toContain("概要");
    expect(editorSource).toContain("故事情节");
    expect(editorSource).toContain("selection.plotPointId === plotPoint.id");
    expect(editorSource).toContain('aria-label="新建分卷"');
    expect(editorStructureSource).toContain('emit("createVolume")');
    expect(editorSource).toContain('"saveVolumeOutline"');
    expect(appSource).toContain('@create-volume="openLongVolumeCreate"');
    expect(appSource).toContain('@save-volume-outline="saveLongVolumeOutline"');
    expect(editorSource).toContain('"savePlotPointContent"');
    expect(appSource).toContain(
      '@save-plot-point-content="saveLongPlotPointContent"'
    );
    expect(editorSource).toContain("章卡内容");
    expect(editorSource).not.toContain("activeChapterCardTab");
    expect(editorSource).not.toContain(">\n            章节大纲\n");
    expect(editorSource).not.toContain(">\n            世界约束\n");
    expect(editorSource).toContain("currentIsChapterCardContent");
    expect(editorSessionSource).toContain(
      "saveDocumentState(stateKey(selectedFile.file.id)"
    );
    expect(longStructureTransactionsSource).toContain(
      "createLongStructureMutationBuilder(index).createChapter"
    );
    expect(longStructureTransactionsSource).toContain(
      "已新建小节“${input.title}”，并同步创建章卡"
    );
    expect(longStructureTransactionsSource).toContain(
      "createLongChapterSelection(\n                  summary,\n                  nextIndex,\n                  created.chapterCard.id"
    );
    expect(appSource).not.toContain('worldConstraints: ""');
    expect(workspaceDialogLayerSource).toContain("<CreateLongVolumeDialog");
    expect(workspaceDialogLayerSource).toContain(
      "@submit=\"emit('submitCreateLongVolume', $event)\""
    );
    expect(workspaceDialogLayerSource).toContain(':source="module.source"');
    expect(dialogCoordinatorSource).toContain("source: volumeCreation.source");
    expect(appSource).toContain(
      '@submit-create-long-volume="createLongVolume"'
    );
    expect(workspaceDialogLayerSource).toContain("<CreateLongPlotPointDialog");
    expect(workspaceDialogLayerSource).toContain(
      "@submit=\"emit('submitCreateLongPlotPoint', $event)\""
    );
    expect(appSource).toContain(
      '@submit-create-long-plot-point="createLongPlotPoint"'
    );
    expect(workspaceDialogLayerSource).toContain(
      "<CreateLongWorldbuildingItemDialog"
    );
    expect(workspaceDialogLayerSource).toContain(
      "@submit=\"emit('submitCreateLongWorldbuildingItem', $event)\""
    );
    expect(appSource).toContain(
      '@submit-create-long-worldbuilding-item="createLongWorldbuildingItem"'
    );
    expect(workspaceDialogLayerSource).toContain(
      "<CreateLongChapterCardDialog"
    );
    expect(dialogCoordinatorSource).toContain(
      "source: chapterCardCreation.source"
    );
    expect(workspaceDialogLayerSource).toContain(':source="module.source"');
    expect(appSource).toContain(
      '@submit-create-long-chapter-card="createLongChapterCard"'
    );
    expect(longWorkspaceDraftTreeSource).toContain(
      "longDraftVolumeId: volume.id"
    );
    expect(longStructureTransactionsSource).toContain(
      "function requestCreateLongDraftSection"
    );
    expect(longStructureTransactionsSource).toContain(
      "function handleLongDraftSectionAction"
    );
    expect(longStructureTransactionsSource).toContain(
      "async function confirmDeleteLongDraftSection"
    );
    expect(longStructureTransactionsSource).toContain('source: "draft"');
    expect(appSource).toContain(
      '@create-long-draft-section="requestCreateLongDraftSection"'
    );
    expect(appSource).toContain(
      '@long-draft-section-action="handleLongDraftSectionAction"'
    );
    expect(workspaceDialogLayerSource).toContain(
      "<DeleteLongDraftSectionDialog"
    );
    expect(appSource).toContain(
      '@confirm-delete-long-draft="confirmDeleteLongDraftSection"'
    );
    expect(longStructureTransactionsSource).toContain(
      "createLongStructureMutationBuilder(index).reorderChapter"
    );
    const draftChildrenProjection = longWorkspaceDraftTreeSource;
    expect(draftChildrenProjection).toContain("longDraftVolumeId: volume.id");
    expect(draftChildrenProjection).not.toContain("return chapters.length");
    expect(chapterCardDialogSource).toContain("新建{{ unitLabel }}");
    expect(chapterCardDialogSource).toContain("补充完整内容");
    expect(chapterCardDialogSource).toContain("确认后会同步创建对应章卡");
    expect(chapterCardDialogSource).toContain(
      "章卡」中维护好章卡，再开始编写正文"
    );
    expect(chapterCardDialogSource).not.toContain("章节大纲和世界约束");
    expect(chapterCardDialogSource).not.toContain("LongStructureManager");
    expect(plotPointDialogSource).toContain("新建剧情点");
    expect(plotPointDialogSource).not.toContain("LongStructureManager");
    const createVolumeInternal = longStructureTransactionsSource.slice(
      longStructureTransactionsSource.indexOf(
        "async function openLongVolumeCreateInternal"
      ),
      longStructureTransactionsSource.indexOf(
        "async function openLongVolumeCreate():"
      )
    );
    expect(createVolumeInternal).toContain("source: target.source");
    expect(createVolumeInternal).not.toContain(
      "longStructureDialogOpen.value = true"
    );
    const createVolumeEntry = longStructureTransactionsSource.slice(
      longStructureTransactionsSource.indexOf(
        "async function openLongVolumeCreate():"
      ),
      longStructureTransactionsSource.indexOf(
        "async function openLongPlotPointCreateForVolumeInternal"
      )
    );
    expect(createVolumeEntry).toContain('source: "book-line"');
    expect(createVolumeEntry).not.toContain(
      "longStructureDialogOpen.value = true"
    );
    expect(longStructureTransactionsSource).toContain(
      'node.longWorkspaceSelection?.root === "draft"'
    );
    expect(longStructureTransactionsSource).toContain(
      'longNavigationNodeId(target.bookId, "root:draft")'
    );
    expect(longStructureTransactionsSource).toContain("剧情阶段已同步生成卷纲");
    const draftRootProjection = longWorkspaceResourceTreeSource.slice(
      longWorkspaceResourceTreeSource.indexOf(
        'node(createLongRootSelection(book, "draft")'
      ),
      longWorkspaceResourceTreeSource.indexOf(
        'node(createLongRootSelection(book, "continuity_ledger")'
      )
    );
    expect(draftRootProjection).toContain('kind: "volume"');
    const createPlotPointEntry = longStructureTransactionsSource.slice(
      longStructureTransactionsSource.indexOf(
        "async function openLongPlotPointCreateForVolumeInternal"
      ),
      longStructureTransactionsSource.indexOf(
        "async function saveLongVolumeOutline"
      )
    );
    expect(createPlotPointEntry).toContain("longPlotPointCreate.value = {");
    expect(createPlotPointEntry).not.toContain(
      "longStructureDialogOpen.value = true"
    );
    const createChapterCardEntry = longStructureTransactionsSource.slice(
      longStructureTransactionsSource.indexOf(
        "async function openLongChapterCardCreateInternal"
      ),
      longStructureTransactionsSource.indexOf(
        "async function handleLongDraftSectionAction"
      )
    );
    expect(createChapterCardEntry).toContain("longChapterCardCreate.value = {");
    expect(createChapterCardEntry).not.toContain("请先在当前分卷中新建剧情点");
    expect(createChapterCardEntry).not.toContain(
      "longStructureDialogOpen.value = true"
    );
    expect(appSource).not.toContain("openLongStructureTreeAction");
    expect(appSource).not.toContain("longStructureSection");
    expect(appSource).not.toContain(":initial-section=");
    expect(appSource).not.toContain(":initial-action=");
    expect(appSource).not.toContain(":initial-item-id=");
    expect(longStructureTransactionsSource).toContain(
      "createLongStructureMutationBuilder(index).createCharacter"
    );
    expect(appSource).toContain('@select-character="selectLongCharacterTab"');
    expect(editorSource).toContain(
      '<LongCharacterNavigation\n        v-if="currentUsesTopCharacterTabs"'
    );
    expect(editorSource).toContain(
      '@select-character="requestSelectCharacter"'
    );
    expect(characterNavigationSource).toContain(
      "activeCharacterId === character.id"
    );
    expect(characterNavigationSource).toContain(
      "'is-loading': pendingCharacterId === character.id"
    );
    expect(editorSource).toContain(
      "selection.key.startsWith('character-group:')"
    );
    expect(editorSource).toContain("selection.description ??");
    expect(editorSource).toContain(
      "'has-navigation-tabs':\n        currentUsesTopCharacterTabs ||"
    );
    expect(editorSource).not.toContain(
      "Boolean(selection?.characterTabs?.length) ||"
    );
    expect(characterDialogSource).toContain("新增人物");
    expect(characterDialogSource).toContain("核心档案和人物关系");
    expect(characterDialogSource).toContain('<Teleport to="body">');
    expect(characterDialogSource).toContain("uiMessage.warning");
  });

  it("edits and persists a character name directly from the document title", () => {
    expect(editorSource).toContain('v-else-if="currentIsCharacterDocument"');
    expect(editorSource).toContain('v-model="characterNameDraft"');
    expect(editorSource).toContain('aria-label="人物姓名"');
    expect(editorSource).toContain('@change="saveCharacterName"');
    expect(editorSource).toContain('@keydown="handleCharacterNameKeydown"');
    expect(editorStructureSource).toContain(
      'emit("renameCharacter", { characterId, name }'
    );
    expect(appSource).toContain('@rename-character="renameLongCharacter"');
    expect(longStructureTransactionsSource).toContain(
      "createLongStructureMutationBuilder(index).updateCharacter"
    );
  });
});
