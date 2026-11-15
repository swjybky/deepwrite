import type { LongWorkspaceRuntimeContext } from "@deepwrite/contracts";
import { renderLongPlotFocus } from "./prompts-long-navigation";

function worldbuildingPosition(
  workspace: LongWorkspaceRuntimeContext
): string[] {
  const focus = workspace.worldbuildingFocus;
  if (!focus)
    return ["未选中世界观文档；需要时按分类目录定位后调用 read 读取。"];
  const category = workspace.worldbuildingDirectory?.categories.find((entry) =>
    focus.categoryId
      ? entry.categoryId === focus.categoryId
      : entry.title === focus.categoryTitle
  );
  const categoryId =
    focus.categoryId ??
    category?.categoryId ??
    workspace.navigation.worldbuilding.find(
      ({ title }) => title === focus.categoryTitle
    )?.id;
  const itemId =
    focus.currentStage.kind === "item"
      ? (focus.currentStage.itemId ??
        (category?.format === "list"
          ? category.items.find(
              ({ title }) => title === focus.currentStage.title
            )?.itemId
          : undefined))
      : undefined;
  const ids = [
    categoryId ? `category_id=${categoryId}` : "",
    itemId ? `item_id=${itemId}` : ""
  ]
    .filter(Boolean)
    .join("；");
  const location =
    focus.format === "list"
      ? `列表型分类「${focus.categoryTitle}」 / ${focus.currentStage.kind === "item" ? `条目「${focus.currentStage.title}」` : "分类概览"}`
      : `文本型分类「${focus.categoryTitle}」`;
  const id = itemId ?? categoryId;
  const hint =
    focus.currentStage.kind === "item" && !itemId && categoryId
      ? `当前条目未列入目录；需要时调用 list（stage=worldbuilding, scope_id=${categoryId}）定位后 read。`
      : `仅定位当前页面，正文未注入；需要时调用 read${id ? `（id=${id}）` : ""}读取。`;
  return [`世界观位置: ${location}${ids ? `（${ids}）` : ""}`, hint];
}

function characterPosition(workspace: LongWorkspaceRuntimeContext): string[] {
  const focus = workspace.characterFocus;
  if (!focus)
    return ["未选中人物文档；需要时按人物类型目录定位后调用 read 读取。"];
  if (focus.currentDocument.kind === "overview") {
    return [
      "人物位置: 人物概览",
      "正文未注入；需要时调用 read（id=character_overview）读取。"
    ];
  }
  const character = workspace.navigation.characters.find((entry) =>
    focus.characterId
      ? entry.id === focus.characterId
      : entry.name === focus.characterName &&
        (focus.group === undefined || entry.group === focus.group)
  );
  const id = focus.characterId ?? character?.id;
  const typeId = focus.group ?? character?.group;
  const document = focus.currentDocument.kind;
  const ids = [
    id ? `id=${id}` : "",
    `document=${document}`,
    typeId ? `type_id=${typeId}` : ""
  ]
    .filter(Boolean)
    .join("；");
  return [
    `人物位置: 「${focus.characterName}」 / ${focus.currentDocument.title}（${ids}）`,
    `仅定位当前人物文档，正文未注入；需要时调用 read${id ? `（id=${id}, document=${document}）` : ""}读取。`
  ];
}

export function renderLongCurrentPosition(
  workspace: LongWorkspaceRuntimeContext
): string {
  const stages: Record<LongWorkspaceRuntimeContext["activeRoot"], string> = {
    worldbuilding: "世界观",
    character_design: "人物",
    plot_design: "剧情",
    draft: "正文",
    continuity_ledger: "连续性"
  };
  const lines = ["【用户当前位置】", `阶段: ${stages[workspace.activeRoot]}`];
  if (workspace.activeRoot === "worldbuilding")
    lines.push(...worldbuildingPosition(workspace));
  if (workspace.activeRoot === "character_design")
    lines.push(...characterPosition(workspace));
  if (workspace.activeRoot === "plot_design" && workspace.plotFocus) {
    lines.push(`剧情位置: ${renderLongPlotFocus(workspace.plotFocus)}`);
  }
  if (
    workspace.activeChapterCardId &&
    workspace.plotFocus?.chapterCardId !== workspace.activeChapterCardId
  ) {
    const chapter = workspace.navigation.chapterCards.find(
      ({ id }) => id === workspace.activeChapterCardId
    );
    lines.push(
      `当前章卡: ${workspace.activeChapterCardId}${chapter ? `（${chapter.title}）` : ""}`
    );
  }
  if (workspace.activeRoot === "plot_design") {
    const focus = workspace.plotFocus;
    const id =
      focus?.chapterCardId ??
      focus?.arcId ??
      focus?.volumeId ??
      (focus?.section === "book_line" ? "book_line" : undefined);
    lines.push(
      id
        ? `正文未注入；需要时调用 read（id=${id}${focus?.chapterCardId ? ", document=card" : ""}）读取。`
        : "正文未注入；需要时按目录定位后调用 read 读取。"
    );
  }
  if (
    workspace.activeRoot === "draft" ||
    workspace.activeRoot === "continuity_ledger"
  ) {
    const id = workspace.activeChapterCardId;
    lines.push(
      id
        ? `正文未注入；需要时调用 read（id=${id}, document=${workspace.activeRoot === "draft" ? "body" : "handoff"}）读取。`
        : "尚未选中章卡；需要时按目录定位后调用 read 读取。"
    );
  }
  return lines.join("\n");
}
