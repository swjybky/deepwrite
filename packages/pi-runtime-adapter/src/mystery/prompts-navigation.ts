import {
  mysteryDocumentTitle,
  type MysteryWorkspaceRuntimeContext
} from "@deepwrite/contracts";

function stageLabel(
  stage: MysteryWorkspaceRuntimeContext["focus"]["stage"]
): string {
  switch (stage) {
    case "truth":
      return "阶段 1 · 上帝视角与核心真相";
    case "characters":
      return "阶段 2 · 人物双文件档案（底牌 / 公开选角）";
    case "scripts":
      return "阶段 3 · 分幕玩家剧本（视角卡 / 正文）";
    case "clues":
      return "阶段 4 · 搜证线索与公共物料";
    case "dm":
      return "阶段 5 · DM 主持与复盘手册";
  }
}

export function renderMysteryNavigation(
  ctx: Pick<
    MysteryWorkspaceRuntimeContext,
    "title" | "genre" | "focus" | "workspaceIndex" | "agentsMd"
  >
): string {
  const index = ctx.workspaceIndex;
  const spec = index.boardSpec;
  const personText =
    spec.narrativePerson === "second" ? "第二人称（你）" : "第一人称（我）";

  const matrixByCell = new Map(
    index.actMatrix.map((cell) => [`${cell.roleId}:${cell.actId}`, cell])
  );

  const lines: string[] = [
    `剧本杀作品：《${ctx.title}》（${ctx.genre}｜bookId=${index.bookId}）`,
    `盘面规格：${spec.playerCount} 人本 · 目标 ${spec.actCountTarget} 幕 · ${personText}${spec.summary ? ` · 简介：${spec.summary}` : ""}`,
    ...(ctx.agentsMd?.trim()
      ? [`【剧本杀创作约定（AGENTS.md）】\n${ctx.agentsMd.trim()}`]
      : []),
    "",
    "【真相与全局设计（stage=truth）】",
    ...index.truthDocuments.map(
      (doc) =>
        `- truth_doc id=${doc.id}「${doc.title}」(${doc.charCount} 字${doc.builtin ? ", 内置" : ""})`
    ),
    `- character_relations「NPC 与人物关系网」(${index.characterRelations.charCount} 字)`,
    "",
    "【角色双文件（stage=characters｜document=profile|pitch）】",
    ...index.roles.map(
      (role) =>
        `- role_id=${role.id}「${role.name}${role.tag ? ` · ${role.tag}` : ""}」 [底牌 ${role.profileChars} 字 / 公开选角 ${role.pitchChars} 字]`
    ),
    "",
    "【分幕矩阵（stage=scripts｜角色 × 幕｜brief字数/body字数）】",
    `- 幕次列表：${index.acts.map((act) => `${act.id}「${act.title}」`).join(" -> ")}`,
    ...index.roles.map((role) => {
      const cells = index.acts
        .map((act) => {
          const stats = matrixByCell.get(`${role.id}:${act.id}`);
          return `${act.id}[卡${stats?.briefChars ?? 0}/本${stats?.bodyChars ?? 0}]`;
        })
        .join(" | ");
      return `- ${role.id}(${role.name}): ${cells}`;
    }),
    "",
    "【公共物料与搜证线索（stage=clues & dm）】",
    `- public_doc id=public_openings「公共序幕与地图」(${index.publicOpenings.charCount} 字)`,
    `- public_doc id=endings「多分支结局」(${index.endings.charCount} 字)`,
    ...(index.clueRounds.length > 0
      ? index.clueRounds.map(
          (round) =>
            `- clue_round id=${round.id}「${round.title}」(${round.charCount} 字)`
        )
      : ['- 暂无搜证轮次（可通过 create(kind="clue_round") 新建）']),
    `- dm_manual「DM 主持手册」(${index.dmManual.charCount} 字)`,
    "",
    `当前界面焦点：${stageLabel(ctx.focus.stage)}${
      ctx.focus.target
        ? ` · ${mysteryDocumentTitle(index, ctx.focus.target)}`
        : ""
    }`
  ];

  return lines.join("\n");
}

export function buildMysteryFixedContextLines(
  ctx: MysteryWorkspaceRuntimeContext
): string[] {
  return [
    "【本轮剧本杀工作区结构快照（正文请按需用 read 读取）】",
    renderMysteryNavigation(ctx)
  ];
}

export function buildMysteryFollowUpContextLines(
  ctx: MysteryWorkspaceRuntimeContext
): string[] {
  return ["【本轮刷新后的剧本杀工作区结构快照】", renderMysteryNavigation(ctx)];
}
