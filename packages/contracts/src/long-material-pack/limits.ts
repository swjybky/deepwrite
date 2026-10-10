import { z } from "zod";
import { MATERIAL_KINDS, type MaterialKind } from "../catalog";

/** Entries aim for one comfortable read; nothing goes past the hard cap. */
export const LONG_MATERIAL_ENTRY_TARGET_CHARACTERS = 8_000;
export const LONG_MATERIAL_ENTRY_MAX_CHARACTERS = 12_000;
/** Indexes (the book guide, overviews) stay short enough to read first. */
export const LONG_MATERIAL_INDEX_MAX_CHARACTERS = 8_000;
export const LONG_MATERIAL_WORLD_ITEM_SOLO_CHARACTERS = 6_000;
export const LONG_MATERIAL_SOLO_CHARACTER_CHARACTERS = 3_000;
export const LONG_MATERIAL_MINOR_GROUP_SIZE = 10;
/** Share of the usable model window the guide evidence may fill. */
export const LONG_MATERIAL_EVIDENCE_RATIO = 0.5;
export const LONG_MATERIAL_EVIDENCE_MAX_CHARACTERS = 2_000_000;
export const LONG_MATERIAL_GUIDE_TEXT_MAX_CHARACTERS = 20_000;

export const LONG_MATERIAL_KINDS = MATERIAL_KINDS;
export const LONG_MATERIAL_LIBRARY_NAMES: Record<MaterialKind, string> = {
  character: "人设",
  gimmick: "梗",
  plot: "剧情",
  draft: "正文",
  other: "其他"
};

export const LongMaterialPackIdSchema = z
  .string()
  .regex(/^lmpack_[a-z0-9]{8,64}$/u);
export type LongMaterialPackId = z.infer<typeof LongMaterialPackIdSchema>;

/** Stable per-pack key of one generated entry, e.g. `character:<id>`. */
export const LongMaterialEntryKeySchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[a-z][a-z0-9_:.-]*$/iu);
