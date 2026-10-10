/** Runtime constants the Renderer may import without the Zod schemas. */
export const LONG_MATERIAL_SECTIONS = [
  "worldbuilding",
  "characters",
  "plot",
  "chapters",
  "foreshadowing",
  "timeline",
  "style"
] as const;
export type LongMaterialSection = (typeof LONG_MATERIAL_SECTIONS)[number];

export const LONG_MATERIAL_SAMPLE_CHAPTER_LIMIT = 20;
export const LONG_MATERIAL_DEFAULT_SAMPLE_CHAPTERS = 3;
export const LONG_MATERIAL_GUIDE_MIN_CONTEXT_WINDOW = 16_000;

export const DEFAULT_LONG_MATERIAL_PACK_OPTIONS = {
  sections: [...LONG_MATERIAL_SECTIONS],
  characterScope: "grouped",
  chapterGrouping: "auto"
} as const satisfies {
  sections: LongMaterialSection[];
  characterScope: "grouped" | "individual";
  chapterGrouping: "auto" | "20" | "50";
};
