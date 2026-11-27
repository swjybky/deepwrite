import {
  LIBRARY_CUSTOM_TAG_MAX_LENGTH,
  type MaterialKind,
  type MaterialLibrary,
  type MaterialLibraryKind,
  type SkillKind,
  type SkillLibrary
} from "@deepwrite/contracts/renderer";
import { registerFeatureMessages } from "../i18n";
import type { ResourceTreeNode } from "../types/workspace";

export const CUSTOM_TAG_SELECT_VALUE = "__custom__";

export const sharingT = registerFeatureMessages("components.librarySharing", {
  "zh-CN": {
    presetLiterature: "文献",
    presetData: "数据",
    presetSetup: "设定",
    presetCase: "案例",
    presetOther: "其他",
    presetGeneral: "通用",
    presetArgumentation: "论证",
    presetStandards: "规范",
    legacyCharacter: "人设",
    legacyGimmick: "脑洞",
    legacyPlot: "剧情",
    legacyDraft: "正文",
    legacyMixed: "综合",
    legacyStyle: "文风",
    officialSuffix: "官方",
    customTagOption: "自定义标签...",
    customTagLabel: "自定义标签",
    customTagPlaceholder: "输入 1-24 字标签，例如：实验记录、方法论",
    enterCustomTagWarning: "请输入自定义标签名称。",
    allTags: "全部标签",
    filterByTag: "按标签筛选",
    searchLibrariesPlaceholder: "搜索资料库名称或标签...",
    quickSelectGroups: "按分组一键勾选",
    groupMemberCount: "{count} 个库",
    selectedCount: "已选 {count} 个",
    entryCount: "{count} 条",
    noLibrariesAvailable: "暂无可用资料库",
    noMatchingLibraries: "没有匹配的资料库",
    missingLibraryLabel: "{id}（当前未加载或已移除）",
    removeMissingBinding: "移除失效绑定 {id}",
    quickCreateLibraryPlaceholder: "输入新资料库名称并直接加入本分组...",
    quickCreateButton: "新建并勾选",
    quickCreatingButton: "创建中...",
    groupMultiSelectHint:
      "可跨标签自由勾选任意数量的资料库组成一个分组，也可随时增删成员。"
  },
  "en-US": {
    presetLiterature: "Literature",
    presetData: "Data",
    presetSetup: "Setup",
    presetCase: "Case",
    presetOther: "Other",
    presetGeneral: "General",
    presetArgumentation: "Argumentation",
    presetStandards: "Standards",
    legacyCharacter: "Character concepts",
    legacyGimmick: "Idea",
    legacyPlot: "Plot",
    legacyDraft: "Prose",
    legacyMixed: "Mixed",
    legacyStyle: "Style",
    officialSuffix: "Official",
    customTagOption: "Custom tag...",
    customTagLabel: "Custom tag",
    customTagPlaceholder: "1-24 characters, e.g. Lab Notes, Methodology",
    enterCustomTagWarning: "Enter a custom tag.",
    allTags: "All tags",
    filterByTag: "Filter by tag",
    searchLibrariesPlaceholder: "Search library name or tag...",
    quickSelectGroups: "Quick-toggle by group",
    groupMemberCount: "{count} libs",
    selectedCount: "{count} selected",
    entryCount: "{count} entries",
    noLibrariesAvailable: "No libraries available",
    noMatchingLibraries: "No matching libraries",
    missingLibraryLabel: "{id} (unavailable)",
    removeMissingBinding: "Remove unavailable binding {id}",
    quickCreateLibraryPlaceholder: "New library name to add to this group...",
    quickCreateButton: "Create & select",
    quickCreatingButton: "Creating...",
    groupMultiSelectHint:
      "Select any combination of libraries across tags to form this group."
  }
});

export function formatMaterialTagBadge(
  library: Pick<MaterialLibrary, "materialKind" | "customTag">
): string {
  if (library.customTag?.trim()) return library.customTag.trim();
  switch (library.materialKind) {
    case "character":
      return sharingT("legacyCharacter");
    case "gimmick":
      return sharingT("legacyGimmick");
    case "plot":
      return sharingT("legacyPlot");
    case "draft":
      return sharingT("legacyDraft");
    case "mixed":
      return sharingT("legacyMixed");
    case "other":
      return sharingT("presetOther");
  }
}

export function formatSkillTagBadge(
  library: Pick<SkillLibrary, "skillKind" | "customTag">
): string {
  if (library.customTag?.trim()) return library.customTag.trim();
  switch (library.skillKind) {
    case "general":
      return sharingT("presetGeneral");
    case "plot":
      return sharingT("legacyPlot");
    case "style":
      return sharingT("legacyStyle");
    case "other":
      return sharingT("presetOther");
  }
}

export function formatNodeTagBadge(
  domain: "material" | "skill",
  node: Pick<
    ResourceTreeNode,
    "customTag" | "categoryTag" | "materialKind" | "skillKind"
  >
): string {
  if (node.customTag?.trim()) return node.customTag.trim();
  if (node.categoryTag?.trim()) return node.categoryTag.trim();
  return domain === "material"
    ? formatMaterialTagBadge({
        materialKind: node.materialKind ?? "other"
      })
    : formatSkillTagBadge({
        skillKind: node.skillKind ?? "other"
      });
}

export interface TagSelectOption {
  value: string;
  label: string;
}

export function buildLibraryTagSelectOptions(
  domain: "material" | "skill",
  includeMixed = false
): TagSelectOption[] {
  if (domain === "material") {
    return [
      { value: "preset:文献", label: sharingT("presetLiterature") },
      { value: "preset:数据", label: sharingT("presetData") },
      { value: "preset:设定", label: sharingT("presetSetup") },
      { value: "preset:案例", label: sharingT("presetCase") },
      { value: "other", label: sharingT("presetOther") },
      { value: "character", label: sharingT("legacyCharacter") },
      { value: "gimmick", label: sharingT("legacyGimmick") },
      { value: "plot", label: sharingT("legacyPlot") },
      { value: "draft", label: sharingT("legacyDraft") },
      ...(includeMixed
        ? [{ value: "mixed", label: sharingT("legacyMixed") }]
        : []),
      { value: CUSTOM_TAG_SELECT_VALUE, label: sharingT("customTagOption") }
    ];
  }
  return [
    { value: "general", label: sharingT("presetGeneral") },
    { value: "preset:论证", label: sharingT("presetArgumentation") },
    { value: "preset:规范", label: sharingT("presetStandards") },
    { value: "other", label: sharingT("presetOther") },
    { value: "plot", label: sharingT("legacyPlot") },
    { value: "style", label: sharingT("legacyStyle") },
    { value: CUSTOM_TAG_SELECT_VALUE, label: sharingT("customTagOption") }
  ];
}

export function initialTagSelectionFromLibrary(input: {
  domain: "material" | "skill";
  materialKind?: MaterialLibraryKind | undefined;
  skillKind?: SkillKind | undefined;
  customTag?: string | undefined;
}): { choice: string; customDraft: string } {
  const trimmed = input.customTag?.trim() ?? "";
  if (trimmed) {
    if (
      input.domain === "material" &&
      (trimmed === "文献" ||
        trimmed === "数据" ||
        trimmed === "设定" ||
        trimmed === "案例")
    ) {
      return { choice: `preset:${trimmed}`, customDraft: "" };
    }
    if (
      input.domain === "skill" &&
      (trimmed === "论证" || trimmed === "规范")
    ) {
      return { choice: `preset:${trimmed}`, customDraft: "" };
    }
    return { choice: CUSTOM_TAG_SELECT_VALUE, customDraft: trimmed };
  }
  if (input.domain === "material") {
    return { choice: input.materialKind ?? "preset:文献", customDraft: "" };
  }
  return { choice: input.skillKind ?? "general", customDraft: "" };
}

export function resolveMaterialTagSelection(
  choice: string,
  customDraft: string,
  fallbackKind: MaterialLibraryKind = "other"
): {
  materialKind: MaterialKind;
  preserveMixed?: boolean;
  customTag: string | null;
} | null {
  if (choice === CUSTOM_TAG_SELECT_VALUE) {
    const normalized = customDraft
      .trim()
      .slice(0, LIBRARY_CUSTOM_TAG_MAX_LENGTH);
    if (!normalized) return null;
    return {
      materialKind: fallbackKind === "mixed" ? "other" : fallbackKind,
      customTag: normalized
    };
  }
  if (choice.startsWith("preset:")) {
    return {
      materialKind: "other",
      customTag: choice.slice("preset:".length)
    };
  }
  if (choice === "mixed") {
    return {
      materialKind: "other",
      preserveMixed: true,
      customTag: null
    };
  }
  const validKind: MaterialKind =
    choice === "character" ||
    choice === "gimmick" ||
    choice === "plot" ||
    choice === "draft" ||
    choice === "other"
      ? choice
      : "other";
  return {
    materialKind: validKind,
    customTag: null
  };
}

export function resolveSkillTagSelection(
  choice: string,
  customDraft: string,
  fallbackKind: SkillKind = "other"
): {
  skillKind: SkillKind;
  customTag: string | null;
} | null {
  if (choice === CUSTOM_TAG_SELECT_VALUE) {
    const normalized = customDraft
      .trim()
      .slice(0, LIBRARY_CUSTOM_TAG_MAX_LENGTH);
    if (!normalized) return null;
    return {
      skillKind: fallbackKind,
      customTag: normalized
    };
  }
  if (choice.startsWith("preset:")) {
    return {
      skillKind: "other",
      customTag: choice.slice("preset:".length)
    };
  }
  const validKind: SkillKind =
    choice === "general" ||
    choice === "plot" ||
    choice === "style" ||
    choice === "other"
      ? choice
      : "general";
  return {
    skillKind: validKind,
    customTag: null
  };
}

export { LIBRARY_CUSTOM_TAG_MAX_LENGTH };
