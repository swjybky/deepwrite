import type { MaterialKind, MaterialStageId } from "./catalog";

export const MATERIAL_STAGE_KINDS: Record<MaterialStageId, MaterialKind> = {
  gimmick: "gimmick",
  character: "character",
  pacing: "plot",
  intro: "plot",
  plot_refine: "plot",
  draft_excerpt: "draft",
  other: "other"
};
