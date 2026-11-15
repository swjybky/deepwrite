import type { LongCreateKind } from "./entity-registry";
import type { LongCreateMeta } from "./create-support";

const fields: Record<
  LongCreateKind,
  { required: (keyof LongCreateMeta)[]; optional: (keyof LongCreateMeta)[] }
> = {
  worldbuilding_item: { required: ["category_id", "title"], optional: [] },
  character: { required: ["name", "type_id"], optional: ["aliases"] },
  volume: { required: ["title"], optional: [] },
  arc: { required: ["title", "volume_id"], optional: [] },
  story_plot: { required: ["title", "arc_id"], optional: [] },
  chapter_card: {
    required: ["title", "volume_id"],
    optional: ["primary_arc_id"]
  },
  story_event: {
    required: ["title"],
    optional: [
      "time_mode",
      "time_label",
      "location",
      "arc_ids",
      "character_ids"
    ]
  },
  event_connection: {
    required: ["source_event_id", "target_event_id", "type"],
    optional: []
  },
  narrative_placement: {
    required: ["chapter_card_id", "event_id", "mode", "disclosure"],
    optional: []
  },
  foreshadowing: {
    required: ["title"],
    optional: ["planned_span", "truth_event_id"]
  },
  foreshadowing_beat: {
    required: ["foreshadowing_id", "type"],
    optional: [
      "volume_id",
      "arc_id",
      "event_id",
      "placement_id",
      "chapter_card_id",
      "planned_scope"
    ]
  },
  continuity_world_reveals: { required: ["chapter_card_id"], optional: [] },
  continuity_character: {
    required: ["chapter_card_id", "character_id", "document"],
    optional: []
  }
};

export const CREATE_META_TABLE = [
  "kind | 必填 meta | 可选 meta",
  ...Object.entries(fields).map(
    ([kind, spec]) =>
      `${kind} | ${spec.required.join(", ")} | ${spec.optional.join(", ") || "—"}`
  ),
  "连续性 chapter_card_id 可省略以沿用当前章；worldbuilding_item.title 兼容从 content 首个 Markdown 标题推断，但建议显式提供。"
].join("\n");

export function assertCreateMeta(
  kind: LongCreateKind,
  meta: LongCreateMeta,
  activeChapterCardId?: string
): void {
  const spec = fields[kind];
  const missing = spec.required.filter((key) => {
    const value =
      key === "chapter_card_id" && kind.startsWith("continuity_")
        ? (meta[key] ?? activeChapterCardId)
        : meta[key];
    return typeof value !== "string" || !value.trim();
  });
  if (missing.length)
    throw new Error(
      `kind=${kind} 缺少 ${missing.map((key) => `meta.${key}`).join("、")}；可选字段：${spec.optional.join("、") || "无"}。`
    );
}
