import type {
  LongMutationReviewTargetKind,
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperation,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import {
  DEFAULT_LONG_CHARACTER_TYPES,
  longLedgerCommitChapterIds,
  longWorkspaceOperationsRequireImpactConfirmation,
  previewLongWorkspaceOperations
} from "@deepwrite/contracts/renderer";
import { registerFeatureMessages } from "../i18n";
import type { AgentEditProposal } from "../types/conversation";

export interface LongProposalChangeRow {
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "danger";
}

export interface LongProposalChangePresentation {
  rows: LongProposalChangeRow[];
  hasContentDiff: boolean;
  contentLabel?: string;
}

const ZH_CN_MESSAGES = {
  sectionTitle: "关联与结构变化",
  contentCard: "章卡正文",
  contentStoryPlot: "情节正文",
  contentForeshadowing: "伏笔内容",
  contentBookLine: "全书故事线",
  contentDefault: "正文变化",
  unlinked: "未关联",
  emptyValue: "空",
  unnamed: "未命名",
  labelTitle: "标题",
  labelName: "姓名",
  labelVolume: "所属分卷",
  labelPrimaryArc: "主剧情点",
  labelPlotArc: "所属剧情点",
  labelCategory: "所属分类",
  labelFormat: "格式",
  labelOrder: "序号",
  labelPosition: "位置调整",
  labelReorder: "顺序调整",
  labelLinkedArcs: "关联剧情点",
  labelAddedArcs: "新增剧情点",
  labelRemovedArcs: "移除剧情点",
  labelCharacters: "涉及人物",
  labelAddedCharacters: "新增人物",
  labelRemovedCharacters: "移除人物",
  labelTime: "时间",
  labelLocation: "地点",
  labelConnection: "事件关系",
  labelConnectionType: "关系类型",
  labelChapter: "所属章节",
  labelEvent: "关联事件",
  labelNarrativeMode: "叙事方式",
  labelDisclosure: "披露程度",
  labelForeshadowing: "所属伏笔",
  labelSpan: "规划跨度",
  labelTruthEvent: "真相事件",
  labelStatus: "状态",
  labelBeatType: "触点类型",
  labelAnchor: "关联锚点",
  labelPlannedScope: "规划范围",
  labelCharacterType: "人物类型",
  labelAliases: "别名",
  labelAddedAliases: "新增别名",
  labelRemovedAliases: "移除别名",
  labelInitFiles: "初始化文件",
  labelContinuityFile: "连续性文件",
  labelDeleteTarget: "删除对象",
  labelCascadeDelete: "联动删除",
  labelAffectedLinks: "关联调整",
  labelDeleteFiles: "删除文件",
  labelLedgerCleanup: "连续性台账",
  labelLayoutSettings: "界面布局",
  companionChapterFiles: "正文、人物状态、交接、伏笔变化（空白模板）",
  companionCharacterFiles: "核心档案、人物关系（空白模板）",
  companionContinuityWorld: "本章世界观揭露档案",
  companionContinuityCharacter: "本章人物当前状态与变更历史",
  placeBefore: "置于「{name}」之前",
  orderChanged: "调序至第 {order} 位",
  arrow: "{before} → {after}",
  itemsAndMore: "{items} 等 {count} 项",
  fileCountAndPaths: "共 {count} 个：{paths}",
  ledgerEditSummary: "{commit}：清理 {count} 项引用",
  commitForChapter: "「{chapter}」归档记录",
  commitFallback: "归档记录",
  unlinkFromArc: "{chapter} 主剧情点清空",
  rebindArc: "{chapter} 主剧情点：{before} → {after}",
  unlinkBeatAnchor: "{beat} 锚点清空",
  updateEventLinks: "{event} 关联引用已调整",
  clearTruthEvent: "{thread} 真相事件绑定清空",
  genericUnlink: "{entity} 关联调整",
  kindVolume: "分卷",
  kindArc: "剧情点",
  kindStoryPlot: "故事情节",
  kindChapterCard: "章卡",
  kindStoryEvent: "故事事件",
  kindEventConnection: "事件连接",
  kindNarrativePlacement: "叙事落点",
  kindForeshadowing: "伏笔线",
  kindForeshadowingBeat: "伏笔触点",
  kindCharacter: "人物",
  kindCharacterType: "人物类型",
  kindWorldbuildingCategory: "世界观分类",
  kindWorldbuildingItem: "世界观条目",
  kindBookLine: "全书故事线",
  kindCharacterOverview: "人物概览",
  kindContinuityFile: "连续性文件",
  connBefore: "早于",
  connSameTime: "同时",
  connOverlaps: "交叠",
  connCauses: "引发",
  connEnables: "促成",
  connConceals: "掩盖",
  modeScene: "正叙出场",
  modeFlashback: "倒叙回溯",
  modeRetelling: "人物转述",
  modeClue: "线索暗示",
  modeMisdirection: "误导假象",
  modeReveal: "真相揭露",
  modeDream: "梦境幻象",
  modeProphecy: "预言预示",
  disclosureHint: "隐晦提示",
  disclosurePartial: "部分公开",
  disclosureFull: "完整呈现",
  disclosureFalse: "虚假表象",
  spanLocal: "局部 / 单章内",
  spanWithinVolume: "本卷内",
  spanCrossVolume: "跨卷",
  beatSource: "源头",
  beatPlant: "埋设",
  beatReinforce: "强化",
  beatMisdirect: "误导",
  beatPartialReveal: "部分揭露",
  beatReveal: "揭露",
  beatPayoff: "回收",
  beatAftermath: "余波",
  statusPlanned: "规划中",
  statusOpen: "已埋设",
  statusProgressing: "推进中",
  statusResolved: "已回收",
  statusAbandoned: "已废弃",
  statusWritten: "已落笔",
  statusCommitted: "已归档",
  statusMissed: "未落笔",
  timeExact: "明确时间",
  timeRelative: "相对时间",
  timeSequence: "仅先后顺序",
  timeUnknown: "未定时间",
  formatList: "条目列表",
  formatText: "整篇文本",
  charProtagonist: "主角",
  charMajorSupporting: "主要配角",
  charMinorSupporting: "次要配角",
  charPasserby: "路人",
  snapSummary: "摘要",
  snapOutline: "大纲",
  snapCoreQuestion: "核心悬念",
  snapHiddenTruth: "隐藏真相",
  snapReaderEffect: "预期读者效果",
  snapWritingPrompt: "写作提示",
  snapNote: "备注",
  snapPath: "文件路径",
  snapCommit: "归档状态",
  snapBooleanYes: "是",
  snapBooleanNo: "否"
} as const;

type ChangeMessageKey = keyof typeof ZH_CN_MESSAGES;

const EN_US_MESSAGES: Record<ChangeMessageKey, string> = {
  sectionTitle: "Links & Structure",
  contentCard: "Chapter Card Body",
  contentStoryPlot: "Story Plot Body",
  contentForeshadowing: "Foreshadowing Content",
  contentBookLine: "Book Storyline",
  contentDefault: "Content Diff",
  unlinked: "Unlinked",
  emptyValue: "None",
  unnamed: "Untitled",
  labelTitle: "Title",
  labelName: "Name",
  labelVolume: "Volume",
  labelPrimaryArc: "Primary Plot Arc",
  labelPlotArc: "Plot Arc",
  labelCategory: "Category",
  labelFormat: "Format",
  labelOrder: "Order",
  labelPosition: "Placement",
  labelReorder: "Reordered Sequence",
  labelLinkedArcs: "Plot Arcs",
  labelAddedArcs: "Added Plot Arcs",
  labelRemovedArcs: "Removed Plot Arcs",
  labelCharacters: "Characters",
  labelAddedCharacters: "Added Characters",
  labelRemovedCharacters: "Removed Characters",
  labelTime: "Time",
  labelLocation: "Location",
  labelConnection: "Event Link",
  labelConnectionType: "Link Type",
  labelChapter: "Chapter",
  labelEvent: "Event",
  labelNarrativeMode: "Narrative Mode",
  labelDisclosure: "Disclosure",
  labelForeshadowing: "Foreshadowing Thread",
  labelSpan: "Planned Span",
  labelTruthEvent: "Truth Event",
  labelStatus: "Status",
  labelBeatType: "Beat Type",
  labelAnchor: "Anchor",
  labelPlannedScope: "Planned Scope",
  labelCharacterType: "Character Role",
  labelAliases: "Aliases",
  labelAddedAliases: "Added Aliases",
  labelRemovedAliases: "Removed Aliases",
  labelInitFiles: "Companion Files",
  labelContinuityFile: "Continuity File",
  labelDeleteTarget: "Delete Target",
  labelCascadeDelete: "Cascade Delete",
  labelAffectedLinks: "Link Adjustments",
  labelDeleteFiles: "Delete Files",
  labelLedgerCleanup: "Ledger Cleanup",
  labelLayoutSettings: "Layout Settings",
  companionChapterFiles:
    "Body, character state, handoff & foreshadowing (blank)",
  companionCharacterFiles: "Core profile & relationships (blank)",
  companionContinuityWorld: "Chapter world-reveal log",
  companionContinuityCharacter: "Chapter character state & history",
  placeBefore: 'Before "{name}"',
  orderChanged: "Moved to #{order}",
  arrow: "{before} → {after}",
  itemsAndMore: "{items} (+{count})",
  fileCountAndPaths: "{count} files: {paths}",
  ledgerEditSummary: "{commit}: {count} reference(s) cleaned",
  commitForChapter: 'Commit for "{chapter}"',
  commitFallback: "Committed ledger record",
  unlinkFromArc: "{chapter}: primary arc cleared",
  rebindArc: "{chapter}: primary arc {before} → {after}",
  unlinkBeatAnchor: "{beat}: anchor cleared",
  updateEventLinks: "{event}: linked items updated",
  clearTruthEvent: "{thread}: truth event cleared",
  genericUnlink: "{entity}: links updated",
  kindVolume: "Volume",
  kindArc: "Plot Arc",
  kindStoryPlot: "Story Plot",
  kindChapterCard: "Chapter Card",
  kindStoryEvent: "Story Event",
  kindEventConnection: "Event Link",
  kindNarrativePlacement: "Narrative Placement",
  kindForeshadowing: "Foreshadowing",
  kindForeshadowingBeat: "Foreshadowing Beat",
  kindCharacter: "Character",
  kindCharacterType: "Character Type",
  kindWorldbuildingCategory: "Worldbuilding Category",
  kindWorldbuildingItem: "Worldbuilding Entry",
  kindBookLine: "Book Storyline",
  kindCharacterOverview: "Character Overview",
  kindContinuityFile: "Continuity File",
  connBefore: "Before",
  connSameTime: "Simultaneous",
  connOverlaps: "Overlaps",
  connCauses: "Causes",
  connEnables: "Enables",
  connConceals: "Conceals",
  modeScene: "Scene",
  modeFlashback: "Flashback",
  modeRetelling: "Retelling",
  modeClue: "Clue",
  modeMisdirection: "Misdirection",
  modeReveal: "Reveal",
  modeDream: "Dream / Vision",
  modeProphecy: "Prophecy",
  disclosureHint: "Hint",
  disclosurePartial: "Partial",
  disclosureFull: "Full",
  disclosureFalse: "False",
  spanLocal: "Local",
  spanWithinVolume: "Within Volume",
  spanCrossVolume: "Cross Volume",
  beatSource: "Source",
  beatPlant: "Plant",
  beatReinforce: "Reinforce",
  beatMisdirect: "Misdirect",
  beatPartialReveal: "Partial Reveal",
  beatReveal: "Reveal",
  beatPayoff: "Payoff",
  beatAftermath: "Aftermath",
  statusPlanned: "Planned",
  statusOpen: "Open",
  statusProgressing: "Progressing",
  statusResolved: "Resolved",
  statusAbandoned: "Abandoned",
  statusWritten: "Written",
  statusCommitted: "Committed",
  statusMissed: "Missed",
  timeExact: "Exact",
  timeRelative: "Relative",
  timeSequence: "Sequence",
  timeUnknown: "Unspecified",
  formatList: "List",
  formatText: "Document",
  charProtagonist: "Protagonist",
  charMajorSupporting: "Major Supporting",
  charMinorSupporting: "Minor Supporting",
  charPasserby: "Minor",
  snapSummary: "Summary",
  snapOutline: "Outline",
  snapCoreQuestion: "Core Question",
  snapHiddenTruth: "Hidden Truth",
  snapReaderEffect: "Expected Reader Effect",
  snapWritingPrompt: "Writing Prompt",
  snapNote: "Note",
  snapPath: "Path",
  snapCommit: "Commit",
  snapBooleanYes: "Yes",
  snapBooleanNo: "No"
};

const t = registerFeatureMessages("components.longProposalChanges", {
  "zh-CN": ZH_CN_MESSAGES,
  "en-US": EN_US_MESSAGES
});

export function longProposalChangeSectionTitle(): string {
  return t("sectionTitle");
}

function getProposalLongTarget(proposal: AgentEditProposal) {
  return (
    proposal.longPlotDesignTarget ??
    proposal.longWorldbuildingTarget ??
    proposal.longCharacterTarget ??
    proposal.longDraftTarget
  );
}

/**
 * Only destructive batches (explicit `.delete` ops or cascading deletions/unlinks
 * flagged by the shared impact policy) hold for impact confirmation.
 */
export function longProposalRequiresConfirmation(
  proposal: AgentEditProposal
): boolean {
  const target = getProposalLongTarget(proposal);
  if (!target) return false;
  if (target.expectedImpact) {
    return longWorkspaceOperationsRequireImpactConfirmation(
      target.batch.operations,
      target.expectedImpact
    );
  }
  return target.batch.operations.some(({ type }) => type.endsWith(".delete"));
}

const CONNECTION_TYPE_KEYS: Record<string, ChangeMessageKey> = {
  before: "connBefore",
  same_time: "connSameTime",
  overlaps: "connOverlaps",
  causes: "connCauses",
  enables: "connEnables",
  conceals: "connConceals"
};

const NARRATIVE_MODE_KEYS: Record<string, ChangeMessageKey> = {
  scene: "modeScene",
  flashback: "modeFlashback",
  retelling: "modeRetelling",
  clue: "modeClue",
  misdirection: "modeMisdirection",
  reveal: "modeReveal",
  dream: "modeDream",
  prophecy: "modeProphecy"
};

const DISCLOSURE_KEYS: Record<string, ChangeMessageKey> = {
  hint: "disclosureHint",
  partial: "disclosurePartial",
  full: "disclosureFull",
  false: "disclosureFalse"
};

const SPAN_KEYS: Record<string, ChangeMessageKey> = {
  local: "spanLocal",
  within_volume: "spanWithinVolume",
  cross_volume: "spanCrossVolume"
};

const BEAT_TYPE_KEYS: Record<string, ChangeMessageKey> = {
  source: "beatSource",
  plant: "beatPlant",
  reinforce: "beatReinforce",
  misdirect: "beatMisdirect",
  partial_reveal: "beatPartialReveal",
  reveal: "beatReveal",
  payoff: "beatPayoff",
  aftermath: "beatAftermath"
};

const STATUS_KEYS: Record<string, ChangeMessageKey> = {
  planned: "statusPlanned",
  open: "statusOpen",
  progressing: "statusProgressing",
  resolved: "statusResolved",
  abandoned: "statusAbandoned",
  written: "statusWritten",
  committed: "statusCommitted",
  missed: "statusMissed"
};

const TIME_MODE_KEYS: Record<string, ChangeMessageKey> = {
  exact: "timeExact",
  relative: "timeRelative",
  sequence: "timeSequence",
  unknown: "timeUnknown"
};

const BUILTIN_CHARACTER_TYPE_KEYS: Record<string, ChangeMessageKey> = {
  protagonist: "charProtagonist",
  major_supporting: "charMajorSupporting",
  minor_supporting: "charMinorSupporting",
  passerby: "charPasserby"
};

const TARGET_KIND_KEYS: Record<
  LongMutationReviewTargetKind | string,
  ChangeMessageKey
> = {
  volume: "kindVolume",
  arc: "kindArc",
  story_plot: "kindStoryPlot",
  "story-plot": "kindStoryPlot",
  chapter_card: "kindChapterCard",
  "chapter-card": "kindChapterCard",
  story_event: "kindStoryEvent",
  "story-event": "kindStoryEvent",
  event_connection: "kindEventConnection",
  "event-connection": "kindEventConnection",
  narrative_placement: "kindNarrativePlacement",
  "narrative-placement": "kindNarrativePlacement",
  foreshadowing: "kindForeshadowing",
  "foreshadowing-thread": "kindForeshadowing",
  foreshadowing_beat: "kindForeshadowingBeat",
  "foreshadowing-beat": "kindForeshadowingBeat",
  character: "kindCharacter",
  "character-type": "kindCharacterType",
  worldbuilding_category: "kindWorldbuildingCategory",
  "worldbuilding-category": "kindWorldbuildingCategory",
  worldbuilding_item: "kindWorldbuildingItem",
  "worldbuilding-item": "kindWorldbuildingItem",
  book_line: "kindBookLine",
  character_overview: "kindCharacterOverview",
  continuity_file: "kindContinuityFile"
};

function labelFromMap(
  map: Record<string, ChangeMessageKey>,
  value: string
): string {
  const key = map[value];
  return key ? t(key) : value;
}

function entityKindLabel(kind: string): string {
  const key = TARGET_KIND_KEYS[kind];
  return key ? t(key) : kind;
}

interface NameLookup {
  volumes: Map<string, string>;
  arcs: Map<string, string>;
  storyPlots: Map<string, string>;
  chapterCards: Map<string, string>;
  events: Map<string, string>;
  foreshadowing: Map<string, string>;
  characters: Map<string, string>;
  characterTypes: Map<string, string>;
  categories: Map<string, string>;
  items: Map<string, string>;
  beats: Map<string, { threadId: string; type: string; order: number }>;
  connections: Map<string, { sourceEventId: string; targetEventId: string }>;
  placements: Map<string, { eventId: string; chapterCardId: string }>;
  commits: Map<string, string>;
  entities: Map<string, string>;
}

function createNameLookup(): NameLookup {
  const characterTypes = new Map<string, string>();
  for (const builtin of DEFAULT_LONG_CHARACTER_TYPES) {
    const key = BUILTIN_CHARACTER_TYPE_KEYS[builtin.id];
    characterTypes.set(builtin.id, key ? t(key) : builtin.title);
  }
  return {
    volumes: new Map(),
    arcs: new Map(),
    storyPlots: new Map(),
    chapterCards: new Map(),
    events: new Map(),
    foreshadowing: new Map(),
    characters: new Map(),
    characterTypes,
    categories: new Map(),
    items: new Map(),
    beats: new Map(),
    connections: new Map(),
    placements: new Map(),
    commits: new Map(),
    entities: new Map()
  };
}

function registerBatchNames(
  lookup: NameLookup,
  batch: LongWorkspaceOperationBatch
): void {
  const set = (map: Map<string, string>, id: string, title: string) => {
    map.set(id, title);
    lookup.entities.set(id, title);
  };
  for (const op of batch.operations) {
    switch (op.type) {
      case "volume.create":
        set(lookup.volumes, op.volume.id, op.volume.title);
        break;
      case "arc.create":
        set(lookup.arcs, op.arc.id, op.arc.title);
        break;
      case "storyPlot.create":
        set(lookup.storyPlots, op.storyPlot.id, op.storyPlot.title);
        break;
      case "chapter.create":
        set(lookup.chapterCards, op.chapterCard.id, op.chapterCard.title);
        break;
      case "event.create":
        set(lookup.events, op.event.id, op.event.title);
        break;
      case "foreshadowing.create":
        set(lookup.foreshadowing, op.thread.id, op.thread.title);
        break;
      case "foreshadowingBeat.create":
        lookup.beats.set(op.beat.id, {
          threadId: op.threadId,
          type: op.beat.type,
          order: op.beat.order
        });
        break;
      case "connection.create":
        lookup.connections.set(op.connection.id, {
          sourceEventId: op.connection.sourceEventId,
          targetEventId: op.connection.targetEventId
        });
        break;
      case "placement.create":
        lookup.placements.set(op.placement.id, {
          eventId: op.placement.eventId,
          chapterCardId: op.placement.chapterCardId
        });
        break;
      case "character.create":
        set(lookup.characters, op.character.id, op.character.name);
        break;
      case "characterType.create":
        set(lookup.characterTypes, op.characterType.id, op.characterType.title);
        break;
      case "worldbuilding.create":
        set(lookup.categories, op.category.id, op.category.title);
        break;
      case "worldbuildingItem.create":
        set(lookup.items, op.item.id, op.item.title);
        break;
    }
  }
}

function buildNameLookup(
  workspaceIndex: LongWorkspaceIndexSnapshot | null | undefined,
  peerProposals: readonly AgentEditProposal[] | undefined,
  confirmation: LongWorkspaceImpactConfirmation | undefined,
  currentBatch: LongWorkspaceOperationBatch | undefined
): NameLookup {
  const lookup = createNameLookup();
  const reg = (map: Map<string, string>, id: string, title: string) => {
    map.set(id, title);
    lookup.entities.set(id, title);
  };
  if (workspaceIndex) {
    for (const v of workspaceIndex.plot.volumes)
      reg(lookup.volumes, v.id, v.title);
    for (const a of workspaceIndex.plot.arcs) reg(lookup.arcs, a.id, a.title);
    for (const sp of workspaceIndex.plot.storyPlots) {
      reg(lookup.storyPlots, sp.id, sp.title);
    }
    for (const c of workspaceIndex.plot.chapterCards) {
      reg(lookup.chapterCards, c.id, c.title);
    }
    for (const e of workspaceIndex.plot.storyEvents) {
      reg(lookup.events, e.id, e.title);
    }
    for (const f of workspaceIndex.plot.foreshadowing) {
      reg(lookup.foreshadowing, f.id, f.title);
      for (const beat of f.beats) {
        lookup.beats.set(beat.id, {
          threadId: f.id,
          type: beat.type,
          order: beat.order
        });
      }
    }
    for (const conn of workspaceIndex.plot.eventConnections) {
      lookup.connections.set(conn.id, {
        sourceEventId: conn.sourceEventId,
        targetEventId: conn.targetEventId
      });
    }
    for (const pl of workspaceIndex.plot.narrativePlacements) {
      lookup.placements.set(pl.id, {
        eventId: pl.eventId,
        chapterCardId: pl.chapterCardId
      });
    }
    for (const ct of workspaceIndex.characterTypes) {
      reg(lookup.characterTypes, ct.id, ct.title);
    }
    for (const ch of workspaceIndex.characters) {
      reg(lookup.characters, ch.id, ch.name);
    }
    for (const cat of workspaceIndex.worldbuilding) {
      reg(lookup.categories, cat.id, cat.title);
      if (cat.format === "list") {
        for (const item of cat.items) reg(lookup.items, item.id, item.title);
      }
    }
    for (const commit of workspaceIndex.ledger.commits) {
      const chapters = longLedgerCommitChapterIds(commit)
        .map((id) => lookup.chapterCards.get(id))
        .filter((title): title is string => Boolean(title));
      lookup.commits.set(
        commit.id,
        chapters.length > 0
          ? t("commitForChapter", { chapter: chapters.join("、") })
          : t("commitFallback")
      );
    }
  }
  if (peerProposals) {
    for (const peer of peerProposals) {
      const peerBatch = getProposalLongTarget(peer)?.batch;
      if (peerBatch) registerBatchNames(lookup, peerBatch);
    }
  }
  if (confirmation) {
    for (const change of confirmation.entityChanges) {
      const snap = change.after ?? change.before;
      if (!snap) continue;
      const name =
        typeof snap.title === "string"
          ? snap.title
          : typeof snap.name === "string"
            ? snap.name
            : undefined;
      if (name) lookup.entities.set(change.id, name);
    }
  }
  if (currentBatch) registerBatchNames(lookup, currentBatch);
  return lookup;
}

function resolveName(
  lookup: NameLookup,
  kind:
    | "volume"
    | "arc"
    | "story_plot"
    | "chapter_card"
    | "story_event"
    | "foreshadowing"
    | "foreshadowing_beat"
    | "event_connection"
    | "narrative_placement"
    | "character"
    | "character_type"
    | "worldbuilding_category"
    | "worldbuilding_item"
    | "any",
  id: string | null | undefined
): string {
  if (!id) return t("unlinked");
  const fromSpecific = ((): string | undefined => {
    switch (kind) {
      case "volume":
        return lookup.volumes.get(id);
      case "arc":
        return lookup.arcs.get(id);
      case "story_plot":
        return lookup.storyPlots.get(id);
      case "chapter_card":
        return lookup.chapterCards.get(id);
      case "story_event":
        return lookup.events.get(id);
      case "foreshadowing":
        return lookup.foreshadowing.get(id);
      case "character":
        return lookup.characters.get(id);
      case "character_type":
        return lookup.characterTypes.get(id);
      case "worldbuilding_category":
        return lookup.categories.get(id);
      case "worldbuilding_item":
        return lookup.items.get(id);
      case "event_connection": {
        const c = lookup.connections.get(id);
        return c
          ? `${resolveName(lookup, "story_event", c.sourceEventId)} → ${resolveName(lookup, "story_event", c.targetEventId)}`
          : undefined;
      }
      case "narrative_placement": {
        const p = lookup.placements.get(id);
        return p
          ? `${resolveName(lookup, "chapter_card", p.chapterCardId)} · ${resolveName(lookup, "story_event", p.eventId)}`
          : undefined;
      }
      case "foreshadowing_beat": {
        const b = lookup.beats.get(id);
        if (!b) return undefined;
        const threadName = lookup.foreshadowing.get(b.threadId);
        const beatName = labelFromMap(BEAT_TYPE_KEYS, b.type);
        return threadName
          ? `${threadName} · ${beatName}`
          : `${beatName} #${b.order}`;
      }
      default:
        return undefined;
    }
  })();
  if (fromSpecific) return fromSpecific;
  const fromAny = lookup.entities.get(id);
  if (fromAny) return fromAny;
  if (kind === "any") return t("unnamed");
  return entityKindLabel(kind);
}

function summarizeNames(items: readonly string[], limit = 6): string {
  if (items.length === 0) return t("emptyValue");
  if (items.length <= limit) return items.join("、");
  return t("itemsAndMore", {
    items: items.slice(0, limit).join("、"),
    count: items.length
  });
}

function listDiff(
  beforeIds: readonly string[],
  afterIds: readonly string[],
  format: (id: string) => string
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);
  const added = afterIds.filter((id) => !beforeSet.has(id)).map(format);
  const removed = beforeIds.filter((id) => !afterSet.has(id)).map(format);
  return { added, removed };
}

function formatArrow(before: string, after: string): string {
  return before === after ? after : t("arrow", { before, after });
}

function resolveConfirmation(
  target: NonNullable<ReturnType<typeof getProposalLongTarget>>,
  workspaceIndex: LongWorkspaceIndexSnapshot | null | undefined
): LongWorkspaceImpactConfirmation | undefined {
  if (target.expectedImpact) return target.expectedImpact;
  if (!workspaceIndex) return undefined;
  try {
    return previewLongWorkspaceOperations(workspaceIndex, target.batch)
      .confirmation;
  } catch {
    return undefined;
  }
}

function collectPrimaryDeleteIds(
  operations: readonly LongWorkspaceOperation[]
): Set<string> {
  const ids = new Set<string>();
  for (const op of operations) {
    if (
      op.type.endsWith(".delete") &&
      "id" in op &&
      typeof op.id === "string"
    ) {
      ids.add(op.id);
    }
  }
  return ids;
}

function operationRows(
  op: LongWorkspaceOperation,
  lookup: NameLookup,
  workspaceIndex: LongWorkspaceIndexSnapshot | null | undefined,
  rows: LongProposalChangeRow[]
): void {
  const push = (
    label: string,
    value: string,
    tone?: LongProposalChangeRow["tone"]
  ) => {
    if (!value) return;
    rows.push({ label, value, ...(tone ? { tone } : {}) });
  };

  switch (op.type) {
    case "chapter.create": {
      push(
        t("labelVolume"),
        resolveName(lookup, "volume", op.chapterCard.volumeId)
      );
      push(
        t("labelPrimaryArc"),
        op.chapterCard.primaryArcId
          ? resolveName(lookup, "arc", op.chapterCard.primaryArcId)
          : t("unlinked")
      );
      push(t("labelOrder"), `#${op.chapterCard.narrativeOrder}`);
      push(t("labelInitFiles"), t("companionChapterFiles"));
      break;
    }
    case "chapter.update": {
      const before = workspaceIndex?.plot.chapterCards.find(
        (c) => c.id === op.id
      );
      if (op.patch.title && op.patch.title !== before?.title) {
        push(
          t("labelTitle"),
          before ? formatArrow(before.title, op.patch.title) : op.patch.title
        );
      }
      break;
    }
    case "chapter.move": {
      const before = workspaceIndex?.plot.chapterCards.find(
        (c) => c.id === op.id
      );
      if (!before || before.volumeId !== op.toVolumeId) {
        const nextVol = resolveName(lookup, "volume", op.toVolumeId);
        push(
          t("labelVolume"),
          before
            ? formatArrow(
                resolveName(lookup, "volume", before.volumeId),
                nextVol
              )
            : nextVol
        );
      }
      if (!before || before.primaryArcId !== op.toPrimaryArcId) {
        const nextArc = op.toPrimaryArcId
          ? resolveName(lookup, "arc", op.toPrimaryArcId)
          : t("unlinked");
        const prevArc = before?.primaryArcId
          ? resolveName(lookup, "arc", before.primaryArcId)
          : t("unlinked");
        push(
          t("labelPrimaryArc"),
          before ? formatArrow(prevArc, nextArc) : nextArc
        );
      }
      if (op.beforeChapterCardId) {
        push(
          t("labelPosition"),
          t("placeBefore", {
            name: resolveName(lookup, "chapter_card", op.beforeChapterCardId)
          })
        );
      }
      break;
    }
    case "chapter.reorder": {
      push(t("labelVolume"), resolveName(lookup, "volume", op.volumeId));
      push(
        t("labelReorder"),
        op.orderedIds
          .slice(0, 6)
          .map((id) => resolveName(lookup, "chapter_card", id))
          .join(" → ") +
          (op.orderedIds.length > 6 ? ` (${op.orderedIds.length})` : "")
      );
      break;
    }
    case "volume.create": {
      push(t("labelOrder"), `#${op.volume.order}`);
      break;
    }
    case "volume.update": {
      const before = workspaceIndex?.plot.volumes.find((v) => v.id === op.id);
      if (op.patch.title && op.patch.title !== before?.title) {
        push(
          t("labelTitle"),
          before ? formatArrow(before.title, op.patch.title) : op.patch.title
        );
      }
      break;
    }
    case "arc.create": {
      push(t("labelVolume"), resolveName(lookup, "volume", op.arc.volumeId));
      break;
    }
    case "arc.update": {
      const before = workspaceIndex?.plot.arcs.find((a) => a.id === op.id);
      if (op.patch.title && op.patch.title !== before?.title) {
        push(
          t("labelTitle"),
          before ? formatArrow(before.title, op.patch.title) : op.patch.title
        );
      }
      break;
    }
    case "arc.move": {
      const before = workspaceIndex?.plot.arcs.find((a) => a.id === op.id);
      const nextVol = resolveName(lookup, "volume", op.toVolumeId);
      if (!before || before.volumeId !== op.toVolumeId) {
        push(
          t("labelVolume"),
          before
            ? formatArrow(
                resolveName(lookup, "volume", before.volumeId),
                nextVol
              )
            : nextVol
        );
      }
      if (op.beforeArcId) {
        push(
          t("labelPosition"),
          t("placeBefore", { name: resolveName(lookup, "arc", op.beforeArcId) })
        );
      }
      break;
    }
    case "storyPlot.create": {
      push(t("labelPlotArc"), resolveName(lookup, "arc", op.storyPlot.arcId));
      break;
    }
    case "storyPlot.update": {
      const before = workspaceIndex?.plot.storyPlots.find(
        (s) => s.id === op.id
      );
      if (op.patch.title && op.patch.title !== before?.title) {
        push(
          t("labelTitle"),
          before ? formatArrow(before.title, op.patch.title) : op.patch.title
        );
      }
      break;
    }
    case "event.create": {
      push(
        t("labelLinkedArcs"),
        summarizeNames(
          op.event.arcIds.map((id) => resolveName(lookup, "arc", id))
        )
      );
      push(
        t("labelCharacters"),
        summarizeNames(
          op.event.characterIds.map((id) =>
            resolveName(lookup, "character", id)
          )
        )
      );
      if (op.event.timeLabel || op.event.timeMode !== "unknown") {
        const mode = labelFromMap(TIME_MODE_KEYS, op.event.timeMode);
        push(
          t("labelTime"),
          op.event.timeLabel ? `${mode} · ${op.event.timeLabel}` : mode
        );
      }
      if (op.event.location) push(t("labelLocation"), op.event.location);
      break;
    }
    case "event.update": {
      const before = workspaceIndex?.plot.storyEvents.find(
        (e) => e.id === op.id
      );
      if (op.patch.title && op.patch.title !== before?.title) {
        push(
          t("labelTitle"),
          before ? formatArrow(before.title, op.patch.title) : op.patch.title
        );
      }
      if (op.patch.arcIds) {
        if (before) {
          const diff = listDiff(before.arcIds, op.patch.arcIds, (id) =>
            resolveName(lookup, "arc", id)
          );
          if (diff.added.length)
            push(t("labelAddedArcs"), summarizeNames(diff.added));
          if (diff.removed.length) {
            push(
              t("labelRemovedArcs"),
              summarizeNames(diff.removed),
              "warning"
            );
          }
        } else {
          push(
            t("labelLinkedArcs"),
            summarizeNames(
              op.patch.arcIds.map((id) => resolveName(lookup, "arc", id))
            )
          );
        }
      }
      if (op.patch.characterIds) {
        if (before) {
          const diff = listDiff(
            before.characterIds,
            op.patch.characterIds,
            (id) => resolveName(lookup, "character", id)
          );
          if (diff.added.length) {
            push(t("labelAddedCharacters"), summarizeNames(diff.added));
          }
          if (diff.removed.length) {
            push(
              t("labelRemovedCharacters"),
              summarizeNames(diff.removed),
              "warning"
            );
          }
        } else {
          push(
            t("labelCharacters"),
            summarizeNames(
              op.patch.characterIds.map((id) =>
                resolveName(lookup, "character", id)
              )
            )
          );
        }
      }
      if (op.patch.timeMode || op.patch.timeLabel !== undefined) {
        const mode = labelFromMap(
          TIME_MODE_KEYS,
          op.patch.timeMode ?? before?.timeMode ?? "unknown"
        );
        const text = op.patch.timeLabel ?? before?.timeLabel ?? "";
        push(t("labelTime"), text ? `${mode} · ${text}` : mode);
      }
      if (op.patch.location !== undefined) {
        push(t("labelLocation"), op.patch.location || t("emptyValue"));
      }
      break;
    }
    case "connection.create": {
      push(
        t("labelConnection"),
        `${resolveName(lookup, "story_event", op.connection.sourceEventId)} → ${resolveName(lookup, "story_event", op.connection.targetEventId)}`
      );
      push(
        t("labelConnectionType"),
        labelFromMap(CONNECTION_TYPE_KEYS, op.connection.type)
      );
      break;
    }
    case "connection.update": {
      const before = workspaceIndex?.plot.eventConnections.find(
        (c) => c.id === op.id
      );
      if (op.patch.sourceEventId || op.patch.targetEventId) {
        const src = resolveName(
          lookup,
          "story_event",
          op.patch.sourceEventId ?? before?.sourceEventId
        );
        const dst = resolveName(
          lookup,
          "story_event",
          op.patch.targetEventId ?? before?.targetEventId
        );
        push(t("labelConnection"), `${src} → ${dst}`);
      }
      if (op.patch.type) {
        const nextType = labelFromMap(CONNECTION_TYPE_KEYS, op.patch.type);
        push(
          t("labelConnectionType"),
          before
            ? formatArrow(
                labelFromMap(CONNECTION_TYPE_KEYS, before.type),
                nextType
              )
            : nextType
        );
      }
      break;
    }
    case "placement.create": {
      push(
        t("labelChapter"),
        resolveName(lookup, "chapter_card", op.placement.chapterCardId)
      );
      push(
        t("labelEvent"),
        resolveName(lookup, "story_event", op.placement.eventId)
      );
      push(
        t("labelNarrativeMode"),
        labelFromMap(NARRATIVE_MODE_KEYS, op.placement.mode)
      );
      push(
        t("labelDisclosure"),
        labelFromMap(DISCLOSURE_KEYS, op.placement.disclosure)
      );
      break;
    }
    case "placement.update": {
      const before = workspaceIndex?.plot.narrativePlacements.find(
        (p) => p.id === op.id
      );
      if (op.patch.eventId) {
        push(
          t("labelEvent"),
          resolveName(lookup, "story_event", op.patch.eventId)
        );
      }
      if (op.patch.mode) {
        const nextMode = labelFromMap(NARRATIVE_MODE_KEYS, op.patch.mode);
        push(
          t("labelNarrativeMode"),
          before
            ? formatArrow(
                labelFromMap(NARRATIVE_MODE_KEYS, before.mode),
                nextMode
              )
            : nextMode
        );
      }
      if (op.patch.disclosure) {
        const nextDisc = labelFromMap(DISCLOSURE_KEYS, op.patch.disclosure);
        push(
          t("labelDisclosure"),
          before
            ? formatArrow(
                labelFromMap(DISCLOSURE_KEYS, before.disclosure),
                nextDisc
              )
            : nextDisc
        );
      }
      break;
    }
    case "placement.move": {
      const before = workspaceIndex?.plot.narrativePlacements.find(
        (p) => p.id === op.id
      );
      const nextCh = resolveName(lookup, "chapter_card", op.toChapterCardId);
      if (!before || before.chapterCardId !== op.toChapterCardId) {
        push(
          t("labelChapter"),
          before
            ? formatArrow(
                resolveName(lookup, "chapter_card", before.chapterCardId),
                nextCh
              )
            : nextCh
        );
      }
      if (op.beforePlacementId) {
        push(
          t("labelPosition"),
          t("placeBefore", {
            name: resolveName(
              lookup,
              "narrative_placement",
              op.beforePlacementId
            )
          })
        );
      }
      break;
    }
    case "foreshadowing.create": {
      if (op.thread.plannedSpan) {
        push(t("labelSpan"), labelFromMap(SPAN_KEYS, op.thread.plannedSpan));
      }
      push(
        t("labelTruthEvent"),
        op.thread.truthEventId
          ? resolveName(lookup, "story_event", op.thread.truthEventId)
          : t("unlinked")
      );
      break;
    }
    case "foreshadowing.update": {
      const before = workspaceIndex?.plot.foreshadowing.find(
        (f) => f.id === op.id
      );
      if (op.patch.title && op.patch.title !== before?.title) {
        push(
          t("labelTitle"),
          before ? formatArrow(before.title, op.patch.title) : op.patch.title
        );
      }
      if (op.patch.plannedSpan) {
        push(t("labelSpan"), labelFromMap(SPAN_KEYS, op.patch.plannedSpan));
      }
      if (op.patch.truthEventId !== undefined) {
        const nextTruth = op.patch.truthEventId
          ? resolveName(lookup, "story_event", op.patch.truthEventId)
          : t("unlinked");
        const prevTruth = before?.truthEventId
          ? resolveName(lookup, "story_event", before.truthEventId)
          : t("unlinked");
        push(
          t("labelTruthEvent"),
          before ? formatArrow(prevTruth, nextTruth) : nextTruth
        );
      }
      if (op.patch.status) {
        push(t("labelStatus"), labelFromMap(STATUS_KEYS, op.patch.status));
      }
      break;
    }
    case "foreshadowingBeat.create": {
      push(
        t("labelForeshadowing"),
        resolveName(lookup, "foreshadowing", op.threadId)
      );
      push(t("labelBeatType"), labelFromMap(BEAT_TYPE_KEYS, op.beat.type));
      const anchors = [
        op.beat.volumeId ? resolveName(lookup, "volume", op.beat.volumeId) : "",
        op.beat.arcId ? resolveName(lookup, "arc", op.beat.arcId) : "",
        op.beat.chapterCardId
          ? resolveName(lookup, "chapter_card", op.beat.chapterCardId)
          : "",
        op.beat.eventId
          ? resolveName(lookup, "story_event", op.beat.eventId)
          : ""
      ].filter(Boolean);
      if (anchors.length) push(t("labelAnchor"), anchors.join(" · "));
      if (op.beat.plannedScope) {
        push(t("labelPlannedScope"), op.beat.plannedScope);
      }
      break;
    }
    case "foreshadowingBeat.update": {
      if (op.patch.type) {
        push(t("labelBeatType"), labelFromMap(BEAT_TYPE_KEYS, op.patch.type));
      }
      const anchorParts: string[] = [];
      if (op.patch.volumeId !== undefined) {
        anchorParts.push(resolveName(lookup, "volume", op.patch.volumeId));
      }
      if (op.patch.arcId !== undefined) {
        anchorParts.push(resolveName(lookup, "arc", op.patch.arcId));
      }
      if (op.patch.chapterCardId !== undefined) {
        anchorParts.push(
          resolveName(lookup, "chapter_card", op.patch.chapterCardId)
        );
      }
      if (op.patch.eventId !== undefined) {
        anchorParts.push(resolveName(lookup, "story_event", op.patch.eventId));
      }
      if (anchorParts.length) push(t("labelAnchor"), anchorParts.join(" · "));
      if (op.patch.plannedScope !== undefined) {
        push(t("labelPlannedScope"), op.patch.plannedScope || t("emptyValue"));
      }
      break;
    }
    case "foreshadowingBeat.move": {
      const beforeThread = lookup.beats.get(op.id)?.threadId;
      const nextThread = resolveName(lookup, "foreshadowing", op.toThreadId);
      push(
        t("labelForeshadowing"),
        beforeThread
          ? formatArrow(
              resolveName(lookup, "foreshadowing", beforeThread),
              nextThread
            )
          : nextThread
      );
      break;
    }
    case "character.create": {
      push(
        t("labelCharacterType"),
        resolveName(lookup, "character_type", op.character.group)
      );
      if (op.character.aliases.length) {
        push(t("labelAliases"), summarizeNames(op.character.aliases));
      }
      push(t("labelInitFiles"), t("companionCharacterFiles"));
      break;
    }
    case "character.update": {
      const before = workspaceIndex?.characters.find((c) => c.id === op.id);
      if (op.patch.name && op.patch.name !== before?.name) {
        push(
          t("labelName"),
          before ? formatArrow(before.name, op.patch.name) : op.patch.name
        );
      }
      if (op.patch.aliases) {
        if (before) {
          const diff = listDiff(before.aliases, op.patch.aliases, (v) => v);
          if (diff.added.length) {
            push(t("labelAddedAliases"), summarizeNames(diff.added));
          }
          if (diff.removed.length) {
            push(
              t("labelRemovedAliases"),
              summarizeNames(diff.removed),
              "warning"
            );
          }
        } else {
          push(t("labelAliases"), summarizeNames(op.patch.aliases));
        }
      }
      break;
    }
    case "character.move": {
      const before = workspaceIndex?.characters.find((c) => c.id === op.id);
      const nextGroup = resolveName(lookup, "character_type", op.toGroup);
      push(
        t("labelCharacterType"),
        before
          ? formatArrow(
              resolveName(lookup, "character_type", before.group),
              nextGroup
            )
          : nextGroup
      );
      break;
    }
    case "worldbuilding.create": {
      push(t("labelTitle"), op.category.title);
      push(
        t("labelFormat"),
        op.category.format === "list" ? t("formatList") : t("formatText")
      );
      break;
    }
    case "worldbuilding.update": {
      if (op.patch.title) push(t("labelTitle"), op.patch.title);
      if (op.patch.format) {
        push(
          t("labelFormat"),
          op.patch.format === "list" ? t("formatList") : t("formatText")
        );
      }
      break;
    }
    case "worldbuildingItem.create": {
      push(
        t("labelCategory"),
        resolveName(lookup, "worldbuilding_category", op.categoryId)
      );
      break;
    }
    case "worldbuildingItem.update": {
      push(
        t("labelCategory"),
        resolveName(lookup, "worldbuilding_category", op.categoryId)
      );
      if (op.patch.title) push(t("labelTitle"), op.patch.title);
      break;
    }
    case "volume.reorder":
    case "arc.reorder":
    case "storyPlot.reorder":
    case "event.reorder":
    case "placement.reorder":
    case "foreshadowing.reorder":
    case "foreshadowingBeat.reorder":
    case "character.reorder":
    case "characterType.reorder":
    case "worldbuilding.reorder":
    case "worldbuildingItem.reorder": {
      const kindMap: Record<string, Parameters<typeof resolveName>[1]> = {
        "volume.reorder": "volume",
        "arc.reorder": "arc",
        "storyPlot.reorder": "story_plot",
        "event.reorder": "story_event",
        "placement.reorder": "narrative_placement",
        "foreshadowing.reorder": "foreshadowing",
        "foreshadowingBeat.reorder": "foreshadowing_beat",
        "character.reorder": "character",
        "characterType.reorder": "character_type",
        "worldbuilding.reorder": "worldbuilding_category",
        "worldbuildingItem.reorder": "worldbuilding_item"
      };
      const k = kindMap[op.type] ?? "any";
      push(
        t("labelReorder"),
        op.orderedIds
          .slice(0, 6)
          .map((id) => resolveName(lookup, k, id))
          .join(" → ") +
          (op.orderedIds.length > 6 ? ` (${op.orderedIds.length})` : "")
      );
      break;
    }
    case "chapterContinuity.worldReveals.create": {
      push(
        t("labelChapter"),
        resolveName(lookup, "chapter_card", op.chapterCardId)
      );
      push(t("labelContinuityFile"), t("companionContinuityWorld"));
      break;
    }
    case "chapterContinuity.character.create": {
      push(
        t("labelChapter"),
        resolveName(lookup, "chapter_card", op.chapterCardId)
      );
      push(
        t("labelCharacters"),
        resolveName(lookup, "character", op.characterId)
      );
      push(t("labelContinuityFile"), t("companionContinuityCharacter"));
      break;
    }
    case "chapterContinuity.worldReveals.delete": {
      push(
        t("labelDeleteTarget"),
        `${resolveName(lookup, "chapter_card", op.chapterCardId)} · ${t("companionContinuityWorld")}`,
        "danger"
      );
      break;
    }
    case "chapterContinuity.character.delete": {
      push(
        t("labelDeleteTarget"),
        `${resolveName(lookup, "chapter_card", op.chapterCardId)} · ${resolveName(lookup, "character", op.characterId)}`,
        "danger"
      );
      break;
    }
    case "featureSettings.update": {
      push(t("labelLayoutSettings"), entityKindLabel("layout"));
      break;
    }
    default: {
      if (
        op.type.endsWith(".delete") &&
        "id" in op &&
        typeof op.id === "string"
      ) {
        const prefix = op.type.replace(".delete", "");
        const deleteKindMap: Record<string, Parameters<typeof resolveName>[1]> =
          {
            volume: "volume",
            arc: "arc",
            storyPlot: "story_plot",
            chapter: "chapter_card",
            event: "story_event",
            connection: "event_connection",
            placement: "narrative_placement",
            foreshadowing: "foreshadowing",
            foreshadowingBeat: "foreshadowing_beat",
            character: "character",
            characterType: "character_type",
            worldbuilding: "worldbuilding_category",
            worldbuildingItem: "worldbuilding_item"
          };
        const rk = deleteKindMap[prefix] ?? "any";
        push(
          t("labelDeleteTarget"),
          `${entityKindLabel(rk === "story_plot" ? "story_plot" : rk)} · ${resolveName(lookup, rk, op.id)}`,
          "danger"
        );
      }
      break;
    }
  }
}

function appendSideEffectRows(
  confirmation: LongWorkspaceImpactConfirmation | undefined,
  operations: readonly LongWorkspaceOperation[],
  lookup: NameLookup,
  rows: LongProposalChangeRow[]
): void {
  if (!confirmation) return;
  const primaryDeleteIds = collectPrimaryDeleteIds(operations);
  const directlyEditedIds = new Set<string>();
  for (const op of operations) {
    if ("id" in op && typeof op.id === "string") directlyEditedIds.add(op.id);
    if (op.type === "chapter.reorder") {
      op.orderedIds.forEach((id) => directlyEditedIds.add(id));
    }
  }

  const cascadedDeletes = confirmation.entityChanges
    .filter(
      (change) => change.action === "delete" && !primaryDeleteIds.has(change.id)
    )
    .map(
      (change) =>
        `${entityKindLabel(change.kind)}「${resolveName(lookup, "any", change.id)}」`
    );
  if (cascadedDeletes.length) {
    rows.push({
      label: t("labelCascadeDelete"),
      value: summarizeNames(cascadedDeletes, 5),
      tone: "danger"
    });
  }

  const sideUpdates: string[] = [];
  for (const change of confirmation.entityChanges) {
    if (change.action !== "update") continue;
    const isDirect = directlyEditedIds.has(change.id);
    if (
      change.kind === "chapter-card" &&
      change.before.primaryArcId !== change.after.primaryArcId &&
      !operations.some(
        (op) => op.type === "chapter.move" && op.id === change.id
      )
    ) {
      const chapter = resolveName(lookup, "chapter_card", change.id);
      if (change.after.primaryArcId === null) {
        sideUpdates.push(t("unlinkFromArc", { chapter }));
      } else {
        sideUpdates.push(
          t("rebindArc", {
            chapter,
            before:
              typeof change.before.primaryArcId === "string"
                ? resolveName(lookup, "arc", change.before.primaryArcId)
                : t("unlinked"),
            after:
              typeof change.after.primaryArcId === "string"
                ? resolveName(lookup, "arc", change.after.primaryArcId)
                : t("unlinked")
          })
        );
      }
    } else if (!isDirect) {
      if (change.kind === "foreshadowing-beat") {
        sideUpdates.push(
          t("unlinkBeatAnchor", {
            beat: resolveName(lookup, "foreshadowing_beat", change.id)
          })
        );
      } else if (change.kind === "story-event") {
        sideUpdates.push(
          t("updateEventLinks", {
            event: resolveName(lookup, "story_event", change.id)
          })
        );
      } else if (
        change.kind === "foreshadowing-thread" &&
        change.before.truthEventId !== change.after.truthEventId &&
        change.after.truthEventId === null
      ) {
        sideUpdates.push(
          t("clearTruthEvent", {
            thread: resolveName(lookup, "foreshadowing", change.id)
          })
        );
      } else {
        sideUpdates.push(
          t("genericUnlink", {
            entity: `${entityKindLabel(change.kind)}「${resolveName(lookup, "any", change.id)}」`
          })
        );
      }
    }
  }
  if (sideUpdates.length) {
    rows.push({
      label: t("labelAffectedLinks"),
      value: summarizeNames(sideUpdates, 5),
      tone: "warning"
    });
  }

  const deletedFiles = confirmation.fileIntents.filter(
    (intent) => intent.action === "delete"
  );
  if (deletedFiles.length) {
    const paths = deletedFiles.slice(0, 4).map((intent) => intent.file.path);
    const tail =
      deletedFiles.length > 4 ? `… (+${deletedFiles.length - 4})` : "";
    rows.push({
      label: t("labelDeleteFiles"),
      value: t("fileCountAndPaths", {
        count: deletedFiles.length,
        paths: `${paths.join("、")}${tail}`
      }),
      tone: "danger"
    });
  }

  if (confirmation.ledgerRecordEdits.length) {
    const ledgerSummaries = confirmation.ledgerRecordEdits
      .slice(0, 4)
      .map((edit) => {
        const cleanedCount =
          edit.removePlacementIds.length +
          edit.removeForeshadowingBeatIds.length +
          edit.removeSubjectIds.length +
          edit.removeKnowledgeAudienceIds.length +
          edit.removeFactIds.length +
          edit.removeFactKeys.length +
          edit.removeKnowledgeKeys.length +
          edit.removeOpenLoopIds.length +
          (edit.replaceHandoff ? 1 : 0);
        return t("ledgerEditSummary", {
          commit: lookup.commits.get(edit.commitId) ?? t("commitFallback"),
          count: cleanedCount
        });
      });
    rows.push({
      label: t("labelLedgerCleanup"),
      value: summarizeNames(ledgerSummaries, 4),
      tone: "danger"
    });
  }
}

function contentSectionLabel(
  review: NonNullable<AgentEditProposal["longPlotDesignTarget"]>["review"]
): string {
  switch (review?.targetKind) {
    case "chapter_card":
      return t("contentCard");
    case "story_plot":
      return t("contentStoryPlot");
    case "foreshadowing":
    case "foreshadowing_beat":
      return t("contentForeshadowing");
    case "book_line":
      return t("contentBookLine");
    default:
      return t("contentDefault");
  }
}

export function buildLongProposalChangePresentation(
  proposal: AgentEditProposal,
  workspaceIndex?: LongWorkspaceIndexSnapshot | null,
  peerProposals?: readonly AgentEditProposal[]
): LongProposalChangePresentation {
  const target = getProposalLongTarget(proposal);
  if (!target) {
    return { rows: [], hasContentDiff: true };
  }
  const matchedIndex =
    workspaceIndex && workspaceIndex.bookId === target.bookId
      ? workspaceIndex
      : undefined;
  const confirmation = resolveConfirmation(target, matchedIndex);
  const lookup = buildNameLookup(
    matchedIndex,
    peerProposals,
    confirmation,
    target.batch
  );
  const rows: LongProposalChangeRow[] = [];

  if (proposal.longPlotDesignTarget) {
    for (const op of target.batch.operations) {
      operationRows(op, lookup, matchedIndex, rows);
    }
    appendSideEffectRows(confirmation, target.batch.operations, lookup, rows);
    const hasContentDiff = proposal.hunks.length > 0;
    const contentLabel =
      hasContentDiff && rows.length > 0
        ? contentSectionLabel(proposal.longPlotDesignTarget.review)
        : undefined;
    return {
      rows,
      hasContentDiff,
      ...(contentLabel ? { contentLabel } : {})
    };
  }

  appendSideEffectRows(confirmation, target.batch.operations, lookup, rows);
  return { rows, hasContentDiff: true };
}

const SKIP_SNAPSHOT_KEYS = new Set([
  "updatedAt",
  "id",
  "provisionalId",
  "file"
]);

function formatSnapshotValue(
  key: string,
  value: unknown,
  lookup: NameLookup
): string | undefined {
  if (value === null || value === undefined) return t("emptyValue");
  if (typeof value === "boolean") {
    return value ? t("snapBooleanYes") : t("snapBooleanNo");
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (key === "volumeId" || key === "toVolumeId") {
      return resolveName(lookup, "volume", value);
    }
    if (key === "arcId" || key === "primaryArcId" || key === "toPrimaryArcId") {
      return resolveName(lookup, "arc", value);
    }
    if (key === "chapterCardId" || key === "toChapterCardId") {
      return resolveName(lookup, "chapter_card", value);
    }
    if (
      key === "eventId" ||
      key === "sourceEventId" ||
      key === "targetEventId" ||
      key === "truthEventId"
    ) {
      return resolveName(lookup, "story_event", value);
    }
    if (key === "sourceId" || key === "targetId") {
      return resolveName(lookup, "any", value);
    }
    if (key === "group" || key === "toGroup") {
      return resolveName(lookup, "character_type", value);
    }
    if (key === "type") {
      return CONNECTION_TYPE_KEYS[value]
        ? t(CONNECTION_TYPE_KEYS[value]!)
        : BEAT_TYPE_KEYS[value]
          ? t(BEAT_TYPE_KEYS[value]!)
          : value;
    }
    if (key === "mode") return labelFromMap(NARRATIVE_MODE_KEYS, value);
    if (key === "disclosure") return labelFromMap(DISCLOSURE_KEYS, value);
    if (key === "plannedSpan") return labelFromMap(SPAN_KEYS, value);
    if (key === "status" || key === "bodyStatus") {
      return labelFromMap(STATUS_KEYS, value);
    }
    if (key === "timeMode") return labelFromMap(TIME_MODE_KEYS, value);
    if (key === "format") {
      return value === "list" ? t("formatList") : t("formatText");
    }
    if (key === "commitId")
      return lookup.commits.get(value) ?? t("commitFallback");
    return value || t("emptyValue");
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return t("emptyValue");
    const rendered = value.map((item) => {
      if (typeof item !== "string") return String(item);
      if (key === "arcIds") return resolveName(lookup, "arc", item);
      if (key === "characterIds") return resolveName(lookup, "character", item);
      return resolveName(lookup, "any", item);
    });
    return summarizeNames(rendered, 6);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.path === "string") return obj.path;
    return undefined;
  }
  return String(value);
}

const SNAPSHOT_KEY_LABELS: Record<string, () => string> = {
  title: () => t("labelTitle"),
  name: () => t("labelName"),
  volumeId: () => t("labelVolume"),
  primaryArcId: () => t("labelPrimaryArc"),
  arcId: () => t("labelPlotArc"),
  chapterCardId: () => t("labelChapter"),
  eventId: () => t("labelEvent"),
  sourceEventId: () => t("labelConnection"),
  targetEventId: () => t("labelEvent"),
  truthEventId: () => t("labelTruthEvent"),
  sourceId: () => t("labelConnection"),
  targetId: () => t("labelAnchor"),
  order: () => t("labelOrder"),
  narrativeOrder: () => t("labelOrder"),
  storyOrder: () => t("labelOrder"),
  orderInChapter: () => t("labelOrder"),
  group: () => t("labelCharacterType"),
  aliases: () => t("labelAliases"),
  arcIds: () => t("labelLinkedArcs"),
  characterIds: () => t("labelCharacters"),
  type: () => t("labelConnectionType"),
  mode: () => t("labelNarrativeMode"),
  disclosure: () => t("labelDisclosure"),
  plannedSpan: () => t("labelSpan"),
  plannedScope: () => t("labelPlannedScope"),
  status: () => t("labelStatus"),
  timeMode: () => t("labelTime"),
  timeLabel: () => t("labelTime"),
  location: () => t("labelLocation"),
  format: () => t("labelFormat"),
  summary: () => t("snapSummary"),
  outline: () => t("snapOutline"),
  coreQuestion: () => t("snapCoreQuestion"),
  hiddenTruth: () => t("snapHiddenTruth"),
  expectedReaderEffect: () => t("snapReaderEffect"),
  writingPrompt: () => t("snapWritingPrompt"),
  note: () => t("snapNote"),
  path: () => t("snapPath"),
  commitId: () => t("snapCommit")
};

export function formatLongImpactSnapshot(
  value: Record<string, unknown> | null,
  workspaceIndex: LongWorkspaceIndexSnapshot | null | undefined,
  emptyLabel: string
): string {
  if (value === null) return emptyLabel;
  const lookup = buildNameLookup(
    workspaceIndex,
    undefined,
    undefined,
    undefined
  );
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (SKIP_SNAPSHOT_KEYS.has(key)) continue;
    if (entry === undefined) continue;
    const formatted = formatSnapshotValue(key, entry, lookup);
    if (!formatted) continue;
    const label = SNAPSHOT_KEY_LABELS[key]?.() ?? key;
    lines.push(`${label}：${formatted}`);
  }
  return lines.length ? lines.join("\n") : emptyLabel;
}
