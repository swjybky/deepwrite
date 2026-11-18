import type { ExtrasAgentResolvedTaskOf } from "@deepwrite/contracts";
import { decompositionRole, type DecompositionRole } from "./roles";

type Task = ExtrasAgentResolvedTaskOf<"long-book-decomposition">;
/** Submission tools of each role; fixed by the developer, never by users. */
export const roleSubmissionTools: Record<DecompositionRole, string[]> = {
  reader: ["submit_chapter_reading"],
  registrar: ["submit_registry_part"],
  chronicler: ["write_chronicle"],
  plot_architect: ["write_book_line", "write_foreshadowing", "write_opening"],
  character_archivist: ["write_character_dossier", "write_character_biography"],
  world_archivist: ["write_world_category"],
  style_analyst: ["write_style_profile"],
  continuity_keeper: ["write_latest_continuity"],
  reviewer: ["report_review_issues"],
  generalist: ["write_topic"]
};
export const assetKinds: Record<string, string> = {
  write_chronicle: "chronicle",
  write_book_line: "book-line",
  write_foreshadowing: "foreshadowing",
  write_opening: "opening",
  write_character_dossier: "character",
  write_character_biography: "character-volume",
  write_world_category: "world",
  write_style_profile: "style",
  write_latest_continuity: "continuity",
  write_topic: "topic"
};
export const dataKinds: Record<string, string> = {
  ...assetKinds,
  submit_chapter_reading: "reading",
  submit_registry_part: "registry-plan",
  report_review_issues: "review"
};
/** Tools whose list grows with the book; their batches may be staged. */
export const STAGED_TOOLS = new Set([
  "write_chronicle",
  "write_book_line",
  "write_foreshadowing",
  "write_world_category"
]);
/** Final text-only calls finish already-staged lists without resending them. */
export const stagedCompletionNotes: Record<string, string> = {
  write_chronicle:
    '若剧情点已全部暂存，直接提交 data: {asset: {summary: "完整编年总结", points: []}}，省略 batch_mode；不要重交已暂存的剧情点。',
  write_book_line:
    '若分卷已全部暂存，直接提交 data: {asset: {content: "完整主线", gimmick: "核心梗", volumes: []}}，省略 batch_mode；不要重交已暂存的分卷。',
  write_foreshadowing:
    "若伏笔线已全部暂存，直接提交 data: {asset: {lines: []}}，省略 batch_mode；不要重交已暂存的伏笔线。",
  write_world_category:
    '若条目已全部暂存，直接提交 data: {asset: {categoryId: "本单元类别标识", overview: "完整类别概览", items: []}}，省略 batch_mode；不要重交已暂存的条目。'
};
export const submissionNotes: Record<string, string> = {
  submit_chapter_reading:
    "每项一个 reading 单元，data.card.chapters 只放这一章；事实来自原文明示时可省略 evidence_kind 或传 stated，推断才传 inferred；按章节顺序提交，本块全部章节保存后系统自动完成阅读块。",
  submit_registry_part:
    "data.plan 只写决定：groups 每组 refs 写同一对象的编号（可带 name、人物 tier、设定 categoryId），单个编号的组只用于标明分级或类别；ignored 写不是任何对象的编号。没写到的编号由系统各自建条，人物默认路人；次数、章号与别名由系统按材料填写。",
  write_character_dossier:
    "registryId 使用单元前缀冒号后的标识，不含 character:。",
  write_character_biography:
    "registryId、volume、startOrder、endOrder 与单元的分卷范围一致。",
  write_world_category: "categoryId 使用单元前缀冒号后的标识，不含 world:。"
};
/** Unfinished units of the package a tool may submit. */
export function submissionUnitIds(
  task: Task,
  name: string,
  role: DecompositionRole
) {
  const kind = dataKinds[name]!;
  return Object.entries(task.input.units)
    .filter(([id, unit]) => {
      if (unit.status === "done" || decompositionRole(id) !== role)
        return false;
      if (kind === "reading") return id.startsWith("reading:");
      if (kind === "registry-plan") return id.startsWith("registry:");
      if (["book-line", "foreshadowing", "opening"].includes(kind))
        return id === `plot:${kind}`;
      return id.startsWith(`${kind}:`);
    })
    .map(([id]) => id);
}
