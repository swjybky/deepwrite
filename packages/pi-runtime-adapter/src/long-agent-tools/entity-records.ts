import {
  parseLongForeshadowingBody,
  serializeLongForeshadowingBody,
  type LongArc,
  type LongEventConnection,
  type LongForeshadowing,
  type LongForeshadowingBeat,
  type LongNarrativePlacement,
  type LongStoryEvent,
  type LongVolume,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  LONG_ENTITY_KIND_LABELS,
  type LongEntityKind
} from "./entity-registry";

/**
 * Plot entities without a Markdown file are still modelled as「一段正文 + 一份
 * 精简信息」: one index field carries the body text, the rest are meta.
 */
export type LongEntityRecord =
  | { kind: "volume"; title: string; entity: LongVolume }
  | { kind: "arc"; title: string; entity: LongArc }
  | { kind: "story_event"; title: string; entity: LongStoryEvent }
  | { kind: "event_connection"; title: string; entity: LongEventConnection }
  | {
      kind: "narrative_placement";
      title: string;
      entity: LongNarrativePlacement;
    }
  | { kind: "foreshadowing"; title: string; entity: LongForeshadowing }
  | {
      kind: "foreshadowing_beat";
      title: string;
      entity: LongForeshadowingBeat;
      threadId: string;
    };

export const serializeForeshadowingBody = serializeLongForeshadowingBody;
export const parseForeshadowingBody = parseLongForeshadowingBody;

function eventTitle(
  index: LongWorkspaceIndexSnapshot,
  eventId: string
): string {
  return (
    index.plot.storyEvents.find(({ id }) => id === eventId)?.title ?? eventId
  );
}

export function longEntityRecord(
  index: LongWorkspaceIndexSnapshot,
  kind: LongEntityKind,
  id: string
): LongEntityRecord {
  if (kind === "volume") {
    const entity = index.plot.volumes.find((value) => value.id === id);
    if (!entity) throw new Error(`分卷 ${id} 不存在。`);
    return { kind, title: entity.title, entity };
  }
  if (kind === "arc") {
    const entity = index.plot.arcs.find((value) => value.id === id);
    if (!entity) throw new Error(`剧情点 ${id} 不存在。`);
    return { kind, title: entity.title, entity };
  }
  if (kind === "story_event") {
    const entity = index.plot.storyEvents.find((value) => value.id === id);
    if (!entity) throw new Error(`故事事件 ${id} 不存在。`);
    return { kind, title: entity.title, entity };
  }
  if (kind === "event_connection") {
    const entity = index.plot.eventConnections.find((value) => value.id === id);
    if (!entity) throw new Error(`事件连接 ${id} 不存在。`);
    const source = eventTitle(index, entity.sourceEventId);
    const target = eventTitle(index, entity.targetEventId);
    return { kind, title: `${source} → ${target}`, entity };
  }
  if (kind === "narrative_placement") {
    const entity = index.plot.narrativePlacements.find(
      (value) => value.id === id
    );
    if (!entity) throw new Error(`叙事落点 ${id} 不存在。`);
    const chapter = index.plot.chapterCards.find(
      ({ id: cardId }) => cardId === entity.chapterCardId
    );
    return {
      kind,
      title: `${eventTitle(index, entity.eventId)} @ ${chapter?.title ?? entity.chapterCardId}`,
      entity
    };
  }
  if (kind === "foreshadowing") {
    const entity = index.plot.foreshadowing.find((value) => value.id === id);
    if (!entity) throw new Error(`伏笔线 ${id} 不存在。`);
    return { kind, title: entity.title, entity };
  }
  if (kind === "foreshadowing_beat") {
    for (const thread of index.plot.foreshadowing) {
      const entity = thread.beats.find((value) => value.id === id);
      if (entity) {
        return {
          kind,
          title: `${thread.title} / ${entity.type}`,
          entity,
          threadId: thread.id
        };
      }
    }
    throw new Error(`伏笔触点 ${id} 不存在。`);
  }
  throw new Error(`${kind} 没有索引正文字段。`);
}

export function longEntityContentField(record: LongEntityRecord): string {
  switch (record.kind) {
    case "volume":
      return record.entity.summary;
    case "arc":
      return record.entity.summary ?? "";
    case "story_event":
      return record.entity.summary;
    case "event_connection":
      return record.entity.note;
    case "narrative_placement":
      return record.entity.writingPrompt;
    case "foreshadowing":
      return serializeForeshadowingBody(record.entity);
    case "foreshadowing_beat":
      return record.entity.note;
  }
}

/** Minimal, human-meaningful metadata surfaced by `read` and accepted by `edit`. */
export function longEntityMeta(
  record: LongEntityRecord
): Record<string, unknown> {
  switch (record.kind) {
    case "volume":
      return { title: record.entity.title };
    case "arc":
      return {
        title: record.entity.title,
        volume_id: record.entity.volumeId
      };
    case "story_event":
      return {
        title: record.entity.title,
        arc_ids: record.entity.arcIds,
        character_ids: record.entity.characterIds,
        time_label: record.entity.timeLabel,
        location: record.entity.location
      };
    case "event_connection":
      return {
        source_event_id: record.entity.sourceEventId,
        target_event_id: record.entity.targetEventId,
        type: record.entity.type
      };
    case "narrative_placement":
      return {
        event_id: record.entity.eventId,
        chapter_card_id: record.entity.chapterCardId,
        mode: record.entity.mode,
        disclosure: record.entity.disclosure
      };
    case "foreshadowing":
      return {
        title: record.entity.title,
        ...(record.entity.plannedSpan
          ? { planned_span: record.entity.plannedSpan }
          : {}),
        truth_event_id: record.entity.truthEventId
      };
    case "foreshadowing_beat":
      return {
        foreshadowing_id: record.threadId,
        type: record.entity.type,
        chapter_card_id: record.entity.chapterCardId,
        arc_id: record.entity.arcId ?? null,
        volume_id: record.entity.volumeId ?? null,
        planned_scope: record.entity.plannedScope
      };
  }
}

const META_FIELD_TO_PATCH: Readonly<Record<string, string>> = {
  title: "title",
  volume_id: "volumeId",
  arc_id: "arcId",
  arc_ids: "arcIds",
  character_ids: "characterIds",
  time_label: "timeLabel",
  location: "location",
  source_event_id: "sourceEventId",
  target_event_id: "targetEventId",
  type: "type",
  event_id: "eventId",
  chapter_card_id: "chapterCardId",
  mode: "mode",
  disclosure: "disclosure",
  planned_span: "plannedSpan",
  truth_event_id: "truthEventId",
  planned_scope: "plannedScope",
  name: "name",
  aliases: "aliases"
};

/**
 * Only fields the underlying update operations accept. Relocation fields such
 * as an arc's volume or a placement's chapter need dedicated move operations
 * and stay under the UI's structure editor.
 */
export const LONG_EDITABLE_META_FIELDS: Readonly<
  Record<LongEntityKind, readonly string[]>
> = {
  worldbuilding_category: [],
  worldbuilding_item: ["title"],
  character: ["name", "aliases"],
  character_overview: [],
  book_line: [],
  volume: ["title"],
  arc: ["title"],
  story_plot: ["title"],
  chapter_card: ["title"],
  story_event: ["title", "time_label", "location", "arc_ids", "character_ids"],
  event_connection: ["source_event_id", "target_event_id", "type"],
  narrative_placement: ["event_id", "mode", "disclosure"],
  foreshadowing: ["title", "planned_span", "truth_event_id"],
  foreshadowing_beat: [
    "type",
    "volume_id",
    "arc_id",
    "chapter_card_id",
    "planned_scope"
  ]
};

export function longMetaPatch(
  kind: LongEntityKind,
  meta: Record<string, unknown>
): Record<string, unknown> {
  const allowed = LONG_EDITABLE_META_FIELDS[kind];
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!allowed.includes(key)) {
      const label = LONG_ENTITY_KIND_LABELS[kind];
      throw new Error(
        allowed.length === 0
          ? `${label}不支持通过 meta 修改信息。`
          : `${label}的 meta 只接受：${allowed.join("、")}。`
      );
    }
    patch[META_FIELD_TO_PATCH[key]!] = value;
  }
  return patch;
}

export function longEntityContentPatch(
  record: LongEntityRecord,
  content: string
): Record<string, unknown> {
  switch (record.kind) {
    case "volume":
      return { summary: content };
    case "arc":
      return { summary: content };
    case "story_event":
      return { summary: content };
    case "event_connection":
      return { note: content };
    case "narrative_placement":
      return { writingPrompt: content };
    case "foreshadowing":
      return parseForeshadowingBody(content);
    case "foreshadowing_beat":
      return { note: content };
  }
}

const UPDATE_OPERATION_TYPES: Readonly<
  Record<LongEntityRecord["kind"], string>
> = {
  volume: "volume.update",
  arc: "arc.update",
  story_event: "event.update",
  event_connection: "connection.update",
  narrative_placement: "placement.update",
  foreshadowing: "foreshadowing.update",
  foreshadowing_beat: "foreshadowingBeat.update"
};

export function longEntityUpdateOperationType(
  kind: LongEntityRecord["kind"]
): string {
  return UPDATE_OPERATION_TYPES[kind];
}
