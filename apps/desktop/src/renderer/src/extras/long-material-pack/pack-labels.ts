import type {
  LongMaterialEntryStatus,
  LongMaterialSection,
  LongMaterialSourceStats
} from "@deepwrite/contracts/renderer";
import { locale, registerFeatureMessages } from "../../i18n";
import enUS from "./messages/en-US";
import zhCN from "./messages/zh-CN";

export const packT = registerFeatureMessages("extras.longMaterialPack", {
  "zh-CN": zhCN,
  "en-US": enUS
});

const SECTION_KEYS = {
  worldbuilding: "sectionWorldbuilding",
  characters: "sectionCharacters",
  plot: "sectionPlot",
  chapters: "sectionChapters",
  foreshadowing: "sectionForeshadowing",
  timeline: "sectionTimeline",
  style: "sectionStyle"
} as const satisfies Record<LongMaterialSection, string>;
export const sectionLabel = (section: LongMaterialSection) =>
  packT(SECTION_KEYS[section]);

/** The count shown beside a section; empty sections are skipped. */
export function sectionDetail(
  section: LongMaterialSection,
  stats: LongMaterialSourceStats,
  samples: number
): { text: string; empty: boolean } {
  const { characters: c } = stats;
  switch (section) {
    case "worldbuilding":
      return {
        text: packT("detailWorldbuilding", {
          categories: stats.worldCategories,
          items: stats.worldItems
        }),
        empty: !stats.worldCategories
      };
    case "characters":
      return {
        text: packT("detailCharacters", {
          protagonist: c.protagonist,
          major: c.major,
          minor: c.minor + c.other
        }),
        empty: !(c.protagonist + c.major + c.minor + c.other + c.passerby)
      };
    case "plot":
      return {
        text: packT("detailPlot", { volumes: stats.volumes, arcs: stats.arcs }),
        empty: !stats.volumes
      };
    case "chapters":
      return {
        text: packT("detailChapters", { count: stats.chapterCards }),
        empty: !stats.chapterCards
      };
    case "foreshadowing":
      return {
        text: packT("detailForeshadowing", { count: stats.foreshadowing }),
        empty: !stats.foreshadowing
      };
    case "timeline":
      return {
        text: packT("detailTimeline", { count: stats.storyEvents }),
        empty: !stats.storyEvents
      };
    case "style":
      return {
        text: stats.decomposition?.hasStyle
          ? packT("detailStyleDecomposition")
          : packT("detailStyleSamples", { count: samples }),
        empty: !stats.decomposition?.hasStyle && !samples
      };
  }
}

const STATUS_KEYS = {
  new: "statusNew",
  updated: "statusUpdated",
  unchanged: "statusUnchanged",
  conflict: "statusConflict",
  stale: "statusStale",
  deleted: "statusDeleted"
} as const satisfies Record<LongMaterialEntryStatus, string>;
export const statusLabel = (status: LongMaterialEntryStatus) =>
  packT(STATUS_KEYS[status]);

export function compactCount(value: number): string {
  return new Intl.NumberFormat(locale.value, {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

export function shortDate(value: string | undefined): string {
  return value
    ? new Intl.DateTimeFormat(locale.value, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(value))
    : "";
}
