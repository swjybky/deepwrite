import {
  LongLedgerCommitRecordSchema,
  deriveLongForeshadowingStatusFromCommittedBeats,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longLedgerCommitFileId,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { WriteClawLongArchiveSource } from "../write-claw-long-archive";
import {
  booleanValue,
  clipped,
  clippedTextDocument,
  enumValue,
  list,
  positiveNumber,
  record,
  safeUnicode,
  stringValue,
  title,
  type DeterministicIdRegistry,
  type WarningCollector
} from "./normalize";
import {
  hasLegacyTimelineAudit,
  legacyLedgerChapterSummary,
  appendLegacyLedgerText
} from "./legacy-ledger";
import {
  chapterPath,
  ledgerPath,
  type ImportDocumentBuilder
} from "./plan-documents";
import { toJsonFileText } from "@deepwrite/shared";

const MAX_INDEX_TEXT = 200_000;
const MAX_SHORT_TEXT = 4_000;

const EVENT_CONNECTION_TYPES = new Set([
  "before",
  "same_time",
  "overlaps",
  "causes",
  "enables",
  "conceals"
]);
const STORY_TIME_MODES = new Set(["exact", "relative", "sequence", "unknown"]);
const NARRATIVE_MODES = new Set([
  "scene",
  "flashback",
  "retelling",
  "clue",
  "misdirection",
  "reveal",
  "dream",
  "prophecy"
]);
const DISCLOSURE_LEVELS = new Set(["hint", "partial", "full", "false"]);
const BEAT_TYPES = new Set([
  "source",
  "plant",
  "reinforce",
  "misdirect",
  "partial_reveal",
  "reveal",
  "payoff",
  "aftermath"
]);
const FORESHADOWING_STATUSES = new Set([
  "planned",
  "open",
  "progressing",
  "resolved",
  "abandoned"
]);

export function uniqueMappedReferences(
  values: unknown,
  kind: string,
  ids: DeterministicIdRegistry,
  warnings: WarningCollector,
  sourcePath: string
): string[] {
  const mapped: string[] = [];
  list(values).forEach((value, index) => {
    const resolved = ids.resolve(kind, value);
    if (!resolved) {
      warnings.preserveDecision(
        "unresolved-reference",
        `${sourcePath}[${index}]`,
        `旧版 ${kind} 引用无法解析，未写入当前结构。`,
        value
      );
      return;
    }
    if (mapped.includes(resolved)) {
      warnings.preserveDecision(
        "merge",
        `${sourcePath}[${index}]`,
        `旧版 ${kind} 引用重复，已合并为单一引用。`,
        value
      );
      return;
    }
    mapped.push(resolved);
  });
  return mapped;
}

export function executionStatus(
  raw: unknown,
  warnings: WarningCollector,
  sourcePath = "long_workspace.json"
): "planned" | "written" {
  const value = stringValue(raw).trim();
  if (
    value === "committed" ||
    value === "missed" ||
    value === "completed" ||
    value === "executed"
  ) {
    warnings.add(
      "旧版已落盘/已执行状态未伪造为当前可逆账本提交，已统一转为 written，导入后可重新核验并提交。"
    );
    warnings.preserveDecision(
      "coerce",
      sourcePath,
      "旧版执行状态没有可验证的现代可逆账本记录，已保守转为 written。",
      raw
    );
    return "written";
  }
  return value === "written" ? "written" : "planned";
}

export function legacyExecutionDecision(
  raw: unknown
): "committed" | "missed" | null {
  const value = stringValue(raw).trim();
  if (value === "missed") return "missed";
  if (value === "committed" || value === "completed" || value === "executed") {
    return "committed";
  }
  return null;
}

export function beforePathExists(
  adjacency: Map<string, Set<string>>,
  start: string,
  target: string
): boolean {
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

export function buildImportedPlot(
  workspace: Record<string, unknown>,
  source: WriteClawLongArchiveSource,
  ids: DeterministicIdRegistry,
  documents: ImportDocumentBuilder,
  warnings: WarningCollector,
  characters: LongWorkspaceIndexSnapshot["characters"],
  bookId: string,
  legacySchemaVersion: number
): {
  volumes: LongWorkspaceIndexSnapshot["plot"]["volumes"];
  arcs: LongWorkspaceIndexSnapshot["plot"]["arcs"];
  chapterCards: LongWorkspaceIndexSnapshot["plot"]["chapterCards"];
  storyEvents: LongWorkspaceIndexSnapshot["plot"]["storyEvents"];
  eventConnections: LongWorkspaceIndexSnapshot["plot"]["eventConnections"];
  narrativePlacements: LongWorkspaceIndexSnapshot["plot"]["narrativePlacements"];
  foreshadowing: LongWorkspaceIndexSnapshot["plot"]["foreshadowing"];
  chapterFiles: LongWorkspaceIndexSnapshot["chapters"];
  legacyCommits: LongWorkspaceIndexSnapshot["ledger"]["commits"];
} {
  const plot = record(workspace.plot);
  let rawVolumes = list(plot.volumes);
  if (rawVolumes.length === 0) {
    rawVolumes = [{ id: "volume-1", name: "第一卷", outline: "", order: 1 }];
    warnings.add("来源缺少分卷，已补充默认第一卷。");
  }
  const volumeRows = rawVolumes
    .map((rawVolume, sourceIndex) => {
      const volume = record(rawVolume);
      return {
        raw: volume,
        sourceIndex,
        legacyId: stringValue(volume.id).trim() || `volume-${sourceIndex + 1}`,
        id: ids.allocate(
          "volume",
          "volume",
          volume.id,
          `volume-${sourceIndex + 1}`
        ),
        sourceOrder: positiveNumber(volume.order, sourceIndex + 1)
      };
    })
    .sort(
      (left, right) =>
        left.sourceOrder - right.sourceOrder ||
        left.sourceIndex - right.sourceIndex
    );
  const volumes = volumeRows.map((row, index) => ({
    id: row.id,
    title: title(
      row.raw.name,
      `第${index + 1}卷`,
      warnings,
      `分卷 ${index + 1} 标题`
    ),
    order: index + 1,
    summary: clipped(
      row.raw.outline,
      MAX_INDEX_TEXT,
      warnings,
      `分卷 ${index + 1} 大纲`
    )
  }));

  const rawArcs = list(plot.arcs);
  const arcRows = rawArcs.map((rawArc, sourceIndex) => {
    const arc = record(rawArc);
    const resolvedVolumeId = ids.resolve("volume", arc.volume_id);
    if (!resolvedVolumeId) {
      warnings.add("部分剧情弧引用了不存在的分卷，已迁入第一卷。");
      warnings.preserveDecision(
        "unresolved-reference",
        `long_workspace.json.plot.arcs[${sourceIndex}].volume_id`,
        "剧情弧引用的分卷不存在，已迁入第一卷。",
        rawArc
      );
    }
    return {
      raw: arc,
      sourceIndex,
      legacyId: stringValue(arc.id).trim() || `arc-${sourceIndex + 1}`,
      id: ids.allocate("arc", "arc", arc.id, `arc-${sourceIndex + 1}`),
      volumeId: resolvedVolumeId ?? volumes[0]!.id,
      sourceOrder: positiveNumber(arc.order, sourceIndex + 1)
    };
  });
  if (arcRows.length === 0) {
    const fallbackId = ids.allocate("arc", "arc", "arc-1-1", "arc-1-1");
    arcRows.push({
      raw: { name: "第一剧情弧线", outline: "" },
      sourceIndex: 0,
      legacyId: "arc-1-1",
      id: fallbackId,
      volumeId: volumes[0]!.id,
      sourceOrder: 1
    });
    warnings.add("来源缺少有效剧情弧，已补充默认剧情弧。");
  }
  const arcOrderByVolume = new Map<string, number>();
  arcRows.sort(
    (left, right) =>
      volumes.findIndex(({ id }) => id === left.volumeId) -
        volumes.findIndex(({ id }) => id === right.volumeId) ||
      left.sourceOrder - right.sourceOrder ||
      left.sourceIndex - right.sourceIndex
  );
  const arcs = arcRows.map((row) => {
    const order = (arcOrderByVolume.get(row.volumeId) ?? 0) + 1;
    arcOrderByVolume.set(row.volumeId, order);
    return {
      id: row.id,
      volumeId: row.volumeId,
      title: title(
        row.raw.name,
        `剧情弧${order}`,
        warnings,
        `剧情弧 ${order} 标题`
      ),
      order,
      outline: clipped(
        row.raw.outline,
        MAX_INDEX_TEXT,
        warnings,
        `剧情弧 ${order} 大纲`
      )
    };
  });

  const rawChapters = record(workspace.chapters);
  const rawCards = [...list(plot.chapter_cards)];
  const knownStageIds = new Set(
    rawCards.map((rawCard) => stringValue(record(rawCard).stage_id).trim())
  );
  for (const stageId of Object.keys(rawChapters)) {
    if (!stageId || knownStageIds.has(stageId)) continue;
    rawCards.push({
      id: `chapter-from-stage:${stageId}`,
      volume_id: volumeRows[0]!.legacyId,
      stage_id: stageId,
      title: record(rawChapters[stageId]).title || "未命名章节",
      narrative_order: rawCards.length + 1
    });
    knownStageIds.add(stageId);
    warnings.add("来源存在没有章卡的章节正文，已为其补建章卡。");
  }
  if (rawCards.length === 0) {
    rawCards.push({
      id: "chapter-card-1-1-1",
      volume_id: volumeRows[0]!.legacyId,
      stage_id: "draft.volume-1.arc-1.chapter-1",
      title: "第一章",
      narrative_order: 1
    });
    warnings.add("来源缺少章卡，已补充默认第一章。");
  }

  const chapterRows = rawCards.map((rawCard, sourceIndex) => {
    const card = record(rawCard);
    const requestedVolume = ids.resolve("volume", card.volume_id);
    const arcId = ids.resolve("arc", card.arc_id) ?? null;
    if (card.arc_id && arcId === null) {
      warnings.add("部分章卡引用了不存在的剧情弧，已移除该关联。");
      warnings.preserveDecision(
        "unresolved-reference",
        `long_workspace.json.plot.chapter_cards[${sourceIndex}].arc_id`,
        "章卡引用的剧情弧不存在，已保留章卡并移除剧情点关联。",
        rawCard
      );
    }
    const currentArc =
      arcId === null ? undefined : arcs.find(({ id }) => id === arcId);
    const stageId =
      stringValue(card.stage_id).trim() || `legacy-stage-${sourceIndex + 1}`;
    return {
      raw: card,
      sourceIndex,
      stageId,
      legacyId: stringValue(card.id).trim() || `chapter-${sourceIndex + 1}`,
      id: ids.allocate(
        "chapter",
        "chapter",
        card.id,
        `chapter-${sourceIndex + 1}:${stageId}`
      ),
      volumeId: currentArc?.volumeId ?? requestedVolume ?? volumes[0]!.id,
      arcId: currentArc?.id ?? null,
      sourceOrder: positiveNumber(
        card.narrative_order ?? card.order,
        sourceIndex + 1
      )
    };
  });
  chapterRows.forEach((row) => ids.alias("chapterStage", row.stageId, row.id));
  chapterRows.sort(
    (left, right) =>
      volumes.findIndex(({ id }) => id === left.volumeId) -
        volumes.findIndex(({ id }) => id === right.volumeId) ||
      left.sourceOrder - right.sourceOrder ||
      left.sourceIndex - right.sourceIndex
  );
  const narrativeOrderByVolume = new Map<string, number>();
  const characterNameById = new Map(
    characters.map((character) => [character.id, character.name])
  );
  const chapterCards: LongWorkspaceIndexSnapshot["plot"]["chapterCards"] = [];
  const chapterFiles: LongWorkspaceIndexSnapshot["chapters"] = [];
  const committedChapterRows: Array<{
    chapterCardId: string;
    legacyCardId: string;
    stageId: string;
    rawChapter: Record<string, unknown>;
  }> = [];
  const currentChapterIdByLegacyStage = new Map<string, string>();
  let committedChapterCount = 0;
  let preservedLedgerChapterCount = 0;
  for (const row of chapterRows) {
    const narrativeOrder = (narrativeOrderByVolume.get(row.volumeId) ?? 0) + 1;
    narrativeOrderByVolume.set(row.volumeId, narrativeOrder);
    const rawChapter = record(rawChapters[row.stageId]);
    const characterNames = uniqueMappedReferences(
      row.raw.characters,
      "character",
      ids,
      warnings,
      `long_workspace.json.plot.chapter_cards[${row.sourceIndex}].characters`
    )
      .map((characterId) => characterNameById.get(characterId) ?? characterId)
      .join("、");
    const cardContent = [
      clipped(
        row.raw.outline,
        MAX_INDEX_TEXT,
        warnings,
        `章节 ${narrativeOrder} 大纲`
      ).trim(),
      clipped(
        row.raw.world_constraints,
        MAX_INDEX_TEXT,
        warnings,
        `章节 ${narrativeOrder} 世界约束`
      ).trim(),
      characterNames ? `出场人物：${characterNames}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    chapterCards.push({
      id: row.id,
      volumeId: row.volumeId,
      primaryArcId: row.arcId,
      title: title(
        rawChapter.title ?? row.raw.title,
        `第${narrativeOrder}章`,
        warnings,
        `章节 ${narrativeOrder} 标题`
      ),
      narrativeOrder
    });
    const legacyStages = record(source.book?.stages);
    const body = clippedTextDocument(
      rawChapter.body ?? legacyStages[row.stageId],
      warnings,
      "章节正文"
    );
    const rawCharacterState = safeUnicode(
      rawChapter.character_state,
      warnings,
      "章节人物状态"
    );
    const characterState = clippedTextDocument(
      appendLegacyLedgerText(
        workspace,
        row.legacyId,
        row.stageId,
        rawCharacterState
      ),
      warnings,
      "章节人物状态（含旧版账本）"
    );
    if (characterState !== rawCharacterState) preservedLedgerChapterCount += 1;
    const handoff = clippedTextDocument(
      rawChapter.handoff ?? rawChapter.handoff_notes,
      warnings,
      "章节交接注意"
    );
    if (
      booleanValue(rawChapter.committed) ||
      stringValue(rawChapter.commit_id).trim()
    ) {
      committedChapterCount += 1;
      committedChapterRows.push({
        chapterCardId: row.id,
        legacyCardId: row.legacyId,
        stageId: row.stageId,
        rawChapter
      });
    }
    chapterFiles.push({
      chapterCardId: row.id,
      bodyStatus: body.trim() ? "written" : "empty",
      body: documents.add(
        longChapterBodyFileId(row.id),
        chapterPath(row.id, "body.md"),
        body
      ),
      card: documents.add(
        longChapterCardFileId(row.id),
        chapterPath(row.id, "card.md"),
        cardContent
      ),
      characterState: documents.add(
        longChapterCharacterStateFileId(row.id),
        chapterPath(row.id, "character-state.md"),
        characterState
      ),
      handoff: documents.add(
        longChapterHandoffFileId(row.id),
        chapterPath(row.id, "handoff.md"),
        handoff
      ),
      foreshadowingChanges: documents.add(
        longChapterForeshadowingChangesFileId(row.id),
        longChapterContinuityFilePath(row.id, "foreshadowing-changes.md"),
        ""
      ),
      worldReveals: null,
      characterContinuity: [],
      commitId: null
    });
    currentChapterIdByLegacyStage.set(row.stageId, row.id);
  }
  if (committedChapterCount > 0) {
    warnings.add(
      `${committedChapterCount} 个旧版已落盘章节将恢复为迁移审计检查点；迁移后正文和连续性文件仍可直接编辑。`
    );
  }
  if (preservedLedgerChapterCount > 0) {
    warnings.add(
      `旧版状态账本文本已并入 ${preservedLedgerChapterCount} 个章节的人物状态文件，等待重新核验后提交。`
    );
  }

  const eventRows = list(plot.story_events)
    .map((rawEvent, sourceIndex) => {
      const event = record(rawEvent);
      return {
        raw: event,
        sourceIndex,
        legacyId: stringValue(event.id).trim() || `event-${sourceIndex + 1}`,
        id: ids.allocate(
          "event",
          "event",
          event.id,
          `event-${sourceIndex + 1}`
        ),
        sourceOrder: positiveNumber(
          event.story_order ?? event.order,
          sourceIndex + 1
        )
      };
    })
    .sort(
      (left, right) =>
        left.sourceOrder - right.sourceOrder ||
        left.sourceIndex - right.sourceIndex
    );
  const storyEvents = eventRows.map((row, index) => ({
    id: row.id,
    title: title(
      row.raw.title ?? row.raw.name,
      `未命名故事事件${index + 1}`,
      warnings,
      `故事事件 ${index + 1} 标题`
    ),
    summary: clipped(
      row.raw.summary ?? row.raw.description,
      MAX_INDEX_TEXT,
      warnings,
      `故事事件 ${index + 1} 摘要`
    ),
    timeMode: enumValue(
      row.raw.time_mode,
      STORY_TIME_MODES,
      "unknown",
      {
        absolute: "exact",
        simultaneous: "sequence",
        overlapping: "sequence"
      },
      {
        warnings,
        sourcePath: `long_workspace.json.plot.story_events[${row.sourceIndex}].time_mode`
      }
    ) as "exact" | "relative" | "sequence" | "unknown",
    timeLabel: clipped(
      row.raw.time_label ?? row.raw.story_time,
      1_000,
      warnings,
      `故事事件 ${index + 1} 时间标签`
    ),
    timeValue: clipped(
      row.raw.time_value,
      1_000,
      warnings,
      `故事事件 ${index + 1} 时间值`
    ),
    storyOrder: index + 1,
    location: clipped(
      row.raw.location,
      1_000,
      warnings,
      `故事事件 ${index + 1} 地点`
    ),
    arcIds: uniqueMappedReferences(
      row.raw.arc_ids,
      "arc",
      ids,
      warnings,
      `long_workspace.json.plot.story_events[${row.sourceIndex}].arc_ids`
    ),
    characterIds: uniqueMappedReferences(
      row.raw.character_ids,
      "character",
      ids,
      warnings,
      `long_workspace.json.plot.story_events[${row.sourceIndex}].character_ids`
    )
  }));

  const eventConnections: LongWorkspaceIndexSnapshot["plot"]["eventConnections"] =
    [];
  const connectionKeys = new Set<string>();
  const beforeAdjacency = new Map<string, Set<string>>();
  list(plot.event_links).forEach((rawConnection, sourceIndex) => {
    const connection = record(rawConnection);
    const sourcePath = `long_workspace.json.plot.event_links[${sourceIndex}]`;
    let sourceEventId = ids.resolve("event", connection.source_event_id);
    let targetEventId = ids.resolve("event", connection.target_event_id);
    let type = stringValue(connection.type ?? connection.kind).trim();
    if (type === "after") {
      [sourceEventId, targetEventId] = [targetEventId, sourceEventId];
      type = "before";
      warnings.preserveDecision(
        "coerce",
        `${sourcePath}.type`,
        "after 连接已通过交换端点规范化为 before。",
        connection.type ?? connection.kind
      );
    }
    type = enumValue(
      type,
      EVENT_CONNECTION_TYPES,
      "before",
      { simultaneous: "same_time" },
      { warnings, sourcePath: `${sourcePath}.type` }
    );
    if (!sourceEventId || !targetEventId || sourceEventId === targetEventId) {
      warnings.add("部分事件连接引用无效或自引用，已跳过。");
      warnings.preserveDecision(
        !sourceEventId || !targetEventId ? "unresolved-reference" : "drop",
        sourcePath,
        !sourceEventId || !targetEventId
          ? "连接端点引用的旧版事件不存在，连接已跳过。"
          : "事件连接自引用，无法进入当前结构，已跳过。",
        rawConnection
      );
      return;
    }
    const key = `${sourceEventId}\0${targetEventId}\0${type}`;
    if (connectionKeys.has(key)) {
      warnings.add("重复的事件连接已合并。");
      warnings.preserveDecision(
        "merge",
        sourcePath,
        "相同端点和类型的事件连接已经存在，本条已合并。",
        rawConnection
      );
      return;
    }
    if (
      type === "before" &&
      beforePathExists(beforeAdjacency, targetEventId, sourceEventId)
    ) {
      warnings.add("会形成循环的 before 事件连接已跳过。");
      warnings.preserveDecision(
        "drop",
        sourcePath,
        "该 before 连接会形成有向循环，已跳过。",
        rawConnection
      );
      return;
    }
    connectionKeys.add(key);
    if (type === "before") {
      const targets = beforeAdjacency.get(sourceEventId) ?? new Set<string>();
      targets.add(targetEventId);
      beforeAdjacency.set(sourceEventId, targets);
    }
    eventConnections.push({
      id: ids.allocate(
        "connection",
        "connection",
        connection.id,
        `connection-${sourceIndex + 1}`
      ),
      sourceEventId,
      targetEventId,
      type: type as
        "before" | "same_time" | "overlaps" | "causes" | "enables" | "conceals",
      note: clipped(
        connection.note ?? connection.description,
        MAX_SHORT_TEXT,
        warnings,
        `事件连接 ${sourceIndex + 1} 说明`
      )
    });
  });

  const rawPlacements = list(plot.narrative_placements);
  const placementRows = rawPlacements.flatMap((rawPlacement, sourceIndex) => {
    const placement = record(rawPlacement);
    const sourcePath = `long_workspace.json.plot.narrative_placements[${sourceIndex}]`;
    const eventId = ids.resolve("event", placement.event_id);
    const chapterCardId =
      ids.resolve("chapter", placement.chapter_card_id) ??
      currentChapterIdByLegacyStage.get(
        stringValue(placement.chapter_stage_id).trim()
      );
    if (!eventId || !chapterCardId) {
      warnings.add("部分叙事落点引用了不存在的事件或章卡，已跳过。");
      warnings.preserveDecision(
        "unresolved-reference",
        sourcePath,
        !eventId && !chapterCardId
          ? "叙事落点的事件和章卡引用均无法解析，已跳过。"
          : !eventId
            ? "叙事落点的事件引用无法解析，已跳过。"
            : "叙事落点的章卡引用无法解析，已跳过。",
        rawPlacement
      );
      return [];
    }
    return [
      {
        raw: placement,
        sourceIndex,
        legacyId:
          stringValue(placement.id).trim() || `placement-${sourceIndex + 1}`,
        id: ids.allocate(
          "placement",
          "placement",
          placement.id,
          `placement-${sourceIndex + 1}`
        ),
        eventId,
        chapterCardId,
        sourceOrder: positiveNumber(placement.order, sourceIndex + 1)
      }
    ];
  });
  placementRows.sort(
    (left, right) =>
      chapterCards.findIndex(({ id }) => id === left.chapterCardId) -
        chapterCards.findIndex(({ id }) => id === right.chapterCardId) ||
      left.sourceOrder - right.sourceOrder ||
      left.sourceIndex - right.sourceIndex
  );
  const placementOrderByChapter = new Map<string, number>();
  const narrativePlacements: LongWorkspaceIndexSnapshot["plot"]["narrativePlacements"] =
    placementRows.map((row) => {
      const orderInChapter =
        (placementOrderByChapter.get(row.chapterCardId) ?? 0) + 1;
      placementOrderByChapter.set(row.chapterCardId, orderInChapter);
      return {
        id: row.id,
        eventId: row.eventId,
        chapterCardId: row.chapterCardId,
        orderInChapter,
        mode: enumValue(
          row.raw.mode ?? row.raw.kind,
          NARRATIVE_MODES,
          "scene",
          { live: "scene" },
          {
            warnings,
            sourcePath: `long_workspace.json.plot.narrative_placements[${row.sourceIndex}].mode`
          }
        ) as
          | "scene"
          | "flashback"
          | "retelling"
          | "clue"
          | "misdirection"
          | "reveal"
          | "dream"
          | "prophecy",
        disclosure: enumValue(
          row.raw.disclosure,
          DISCLOSURE_LEVELS,
          "hint",
          {},
          {
            warnings,
            sourcePath: `long_workspace.json.plot.narrative_placements[${row.sourceIndex}].disclosure`
          }
        ) as "hint" | "partial" | "full" | "false",
        writingPrompt: clipped(
          row.raw.note ?? row.raw.intended_knowledge,
          MAX_SHORT_TEXT,
          warnings,
          `叙事落点 ${row.sourceIndex + 1} 写作提示`
        ),
        status: executionStatus(
          row.raw.execution_status ?? row.raw.status,
          warnings,
          `long_workspace.json.plot.narrative_placements[${row.sourceIndex}].execution_status`
        ),
        commitId: null
      };
    });
  const placementByLegacyId = new Map<string, (typeof placementRows)[number]>();
  placementRows.forEach((row) => {
    if (!placementByLegacyId.has(row.legacyId)) {
      placementByLegacyId.set(row.legacyId, row);
    }
  });

  const legacyBeatStatusById = new Map<string, unknown>();
  const foreshadowing: LongWorkspaceIndexSnapshot["plot"]["foreshadowing"] =
    list(plot.foreshadowing).map((rawThread, threadIndex) => {
      const thread = record(rawThread);
      const threadId = ids.allocate(
        "foreshadowing",
        "foreshadow",
        thread.id,
        `foreshadow-${threadIndex + 1}`
      );
      const threadTitle = title(
        thread.name ?? thread.title,
        `未命名伏笔${threadIndex + 1}`,
        warnings,
        `伏笔 ${threadIndex + 1} 标题`
      );
      const beats = list(thread.beats).map((rawBeat, beatIndex) => {
        const beat = record(rawBeat);
        const beatSourcePath = `long_workspace.json.plot.foreshadowing[${threadIndex}].beats[${beatIndex}]`;
        const legacyPlacementId = stringValue(beat.placement_id).trim();
        const placement = placementByLegacyId.get(legacyPlacementId);
        if (legacyPlacementId && !placement) {
          warnings.preserveDecision(
            "unresolved-reference",
            `${beatSourcePath}.placement_id`,
            "伏笔节拍引用的旧版叙事落点不存在；将继续尝试独立事件或章卡引用。",
            beat.placement_id
          );
        }
        const placementId = placement?.id ?? null;
        const directEventId = ids.resolve("event", beat.event_id);
        if (!placement && stringValue(beat.event_id).trim() && !directEventId) {
          warnings.preserveDecision(
            "unresolved-reference",
            `${beatSourcePath}.event_id`,
            "伏笔节拍引用的旧版事件不存在。",
            beat.event_id
          );
        }
        const eventId = placement?.eventId ?? directEventId ?? null;
        const directChapterId = ids.resolve("chapter", beat.chapter_card_id);
        const stageChapterId = currentChapterIdByLegacyStage.get(
          stringValue(beat.chapter_stage_id).trim()
        );
        if (
          !placement &&
          !directChapterId &&
          !stageChapterId &&
          (stringValue(beat.chapter_card_id).trim() ||
            stringValue(beat.chapter_stage_id).trim())
        ) {
          warnings.preserveDecision(
            "unresolved-reference",
            `${beatSourcePath}.chapter_card_id`,
            "伏笔节拍引用的旧版章卡或章节阶段不存在。",
            {
              chapter_card_id: beat.chapter_card_id,
              chapter_stage_id: beat.chapter_stage_id
            }
          );
        }
        const chapterCardId =
          placement?.chapterCardId ?? directChapterId ?? stageChapterId ?? null;
        let plannedScope = clipped(
          beat.target_scope,
          1_000,
          warnings,
          `伏笔节拍 ${beatIndex + 1} 范围`
        );
        if (
          !eventId &&
          !placementId &&
          !chapterCardId &&
          !plannedScope.trim()
        ) {
          plannedScope = `旧版未指定范围：${threadTitle}`;
        }
        const beatId = ids.allocate(
          "beat",
          "beat",
          beat.id,
          `foreshadow-${threadIndex + 1}-beat-${beatIndex + 1}`
        );
        legacyBeatStatusById.set(beatId, beat.status ?? beat.execution_status);
        return {
          id: beatId,
          type: enumValue(
            beat.kind ?? beat.type,
            BEAT_TYPES,
            "plant",
            {
              resolve: "payoff",
              resolution: "payoff",
              consequence: "aftermath"
            },
            {
              warnings,
              sourcePath: `${beatSourcePath}.type`
            }
          ) as
            | "source"
            | "plant"
            | "reinforce"
            | "misdirect"
            | "partial_reveal"
            | "reveal"
            | "payoff"
            | "aftermath",
          order: beatIndex + 1,
          eventId,
          placementId,
          chapterCardId,
          plannedScope,
          note: clipped(
            beat.intended_knowledge ?? beat.note,
            MAX_SHORT_TEXT,
            warnings,
            `伏笔节拍 ${beatIndex + 1} 说明`
          ),
          status: executionStatus(
            beat.status,
            warnings,
            `${beatSourcePath}.status`
          ),
          commitId: null
        };
      });
      const truthEventId = ids.resolve("event", thread.truth_event_id);
      if (stringValue(thread.truth_event_id).trim() && !truthEventId) {
        warnings.preserveDecision(
          "unresolved-reference",
          `long_workspace.json.plot.foreshadowing[${threadIndex}].truth_event_id`,
          "伏笔线引用的真相事件不存在，已保守置空。",
          thread.truth_event_id
        );
      }
      return {
        id: threadId,
        title: threadTitle,
        coreQuestion: clipped(
          thread.question,
          MAX_INDEX_TEXT,
          warnings,
          `伏笔 ${threadIndex + 1} 核心问题`
        ),
        truthEventId: truthEventId ?? null,
        expectedReaderEffect: clipped(
          thread.intended_effect,
          MAX_INDEX_TEXT,
          warnings,
          `伏笔 ${threadIndex + 1} 预期效果`
        ),
        status: enumValue(
          thread.status,
          FORESHADOWING_STATUSES,
          "open",
          { progressed: "progressing", completed: "resolved" },
          {
            warnings,
            sourcePath: `long_workspace.json.plot.foreshadowing[${threadIndex}].status`
          }
        ) as "planned" | "open" | "progressing" | "resolved" | "abandoned",
        beats
      };
    });

  const legacyCommits: LongWorkspaceIndexSnapshot["ledger"]["commits"] = [];
  for (const thread of foreshadowing) {
    if (thread.status !== "abandoned") {
      thread.status = deriveLongForeshadowingStatusFromCommittedBeats(
        thread.beats
      );
    }
  }
  if (committedChapterRows.length > 0) {
    const committedIds = new Set(
      committedChapterRows.map(({ chapterCardId }) => chapterCardId)
    );
    const prefixIsContiguous = chapterCards.every((chapter, index) =>
      index < committedChapterRows.length
        ? committedIds.has(chapter.id)
        : !committedIds.has(chapter.id)
    );
    if (!prefixIsContiguous) {
      throw new Error(
        "Write Claw 已落盘章节不是连续叙事前缀，无法安全恢复连续性检查点。"
      );
    }

    const placementRawById = new Map(
      placementRows.map((row) => [row.id, row.raw])
    );
    for (const [commitIndex, committedRow] of committedChapterRows.entries()) {
      const sequence = commitIndex + 1;
      const legacyCommitId = stringValue(
        committedRow.rawChapter.commit_id
      ).trim();
      const rawCommittedAt = stringValue(
        committedRow.rawChapter.committed_at
      ).trim();
      const parsedCommittedAt = new Date(rawCommittedAt);
      if (
        legacySchemaVersion >= 3 &&
        (!legacyCommitId ||
          !rawCommittedAt ||
          Number.isNaN(parsedCommittedAt.valueOf()) ||
          !hasLegacyTimelineAudit(
            workspace,
            committedRow.legacyCardId,
            committedRow.stageId,
            legacyCommitId
          ))
      ) {
        throw new Error(
          `Write Claw schema v${legacySchemaVersion} 的已提交章节缺少 commit_id、committed_at 或时间线审计，已拒绝不完整迁移。`
        );
      }
      const commitId = ids.allocate(
        "commit",
        "commit",
        legacyCommitId,
        `legacy-import-${sequence}-${committedRow.legacyCardId}`
      );
      const committedAt = Number.isNaN(parsedCommittedAt.valueOf())
        ? new Date(sequence * 1_000).toISOString()
        : parsedCommittedAt.toISOString();
      if (!rawCommittedAt) {
        warnings.add(
          "旧版 v1/v2 已提交章节缺少时间，迁移检查点使用稳定的未知时间占位。"
        );
      }

      const placements = narrativePlacements.filter(
        ({ chapterCardId }) => chapterCardId === committedRow.chapterCardId
      );
      const placementChanges = placements.map((placement) => {
        const raw = placementRawById.get(placement.id);
        const decision =
          legacyExecutionDecision(raw?.execution_status ?? raw?.status) ??
          "missed";
        placement.status = decision;
        placement.commitId = commitId;
        return {
          placementId: placement.id,
          after: { status: decision, commitId },
          note:
            clipped(
              raw?.note ?? raw?.writing_prompt,
              4_000,
              warnings,
              "旧版落点迁移证据"
            ).trim() || "旧版检查点未提供单独证据。"
        };
      });

      const beatChanges: Array<{
        beatId: string;
        after: {
          status: "committed" | "missed";
          commitId: string;
        };
        note: string;
      }> = [];
      const changedBeatIds = new Set<string>();
      for (const thread of foreshadowing) {
        for (const beat of thread.beats) {
          const placement = beat.placementId
            ? narrativePlacements.find(
                (candidate) => candidate.id === beat.placementId
              )
            : undefined;
          const resolvedChapterId =
            beat.chapterCardId ?? placement?.chapterCardId ?? null;
          if (resolvedChapterId !== committedRow.chapterCardId) continue;
          const decision =
            legacyExecutionDecision(legacyBeatStatusById.get(beat.id)) ??
            "missed";
          beat.status = decision;
          beat.commitId = commitId;
          changedBeatIds.add(beat.id);
          beatChanges.push({
            beatId: beat.id,
            after: { status: decision, commitId },
            note: beat.note.trim() || "旧版检查点未提供单独证据。"
          });
        }
      }

      const threadChanges = foreshadowing
        .filter((thread) =>
          thread.beats.some((beat) => changedBeatIds.has(beat.id))
        )
        .map((thread) => {
          const after =
            thread.status === "abandoned"
              ? "abandoned"
              : deriveLongForeshadowingStatusFromCommittedBeats(thread.beats);
          thread.status = after;
          return {
            foreshadowingId: thread.id,
            after
          };
        });

      const record = LongLedgerCommitRecordSchema.parse({
        schemaVersion: 1,
        id: commitId,
        bookId,
        sequence,
        chapterCardId: committedRow.chapterCardId,
        committedAt,
        commitMessage: `Write Claw 旧版迁移检查点 #${sequence}`,
        chapterSummary: legacyLedgerChapterSummary(
          workspace,
          committedRow.legacyCardId,
          committedRow.stageId
        ),
        committedThroughChapterId: committedRow.chapterCardId,
        placementChanges,
        foreshadowingBeatChanges: beatChanges,
        foreshadowingThreadChanges: threadChanges
      });
      const recordReference = documents.add(
        longLedgerCommitFileId(commitId),
        ledgerPath(commitId),
        toJsonFileText(record),
        "json"
      );
      const chapterFile = chapterFiles.find(
        ({ chapterCardId }) => chapterCardId === committedRow.chapterCardId
      )!;
      chapterFile.commitId = commitId;
      legacyCommits.push({
        id: commitId,
        mode: "structured",
        sequence,
        chapterCardId: committedRow.chapterCardId,
        committedAt,
        placementIds: placements.map(({ id }) => id),
        foreshadowingBeatIds: beatChanges.map(({ beatId }) => beatId),
        recordFile: recordReference
      });
    }
    warnings.add(
      "旧版连续性已恢复为迁移审计检查点；迁移后的正文与连续性文件可继续直接编辑。"
    );
  }

  return {
    volumes,
    arcs,
    chapterCards,
    storyEvents,
    eventConnections,
    narrativePlacements,
    foreshadowing,
    chapterFiles,
    legacyCommits
  };
}
