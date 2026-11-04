import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const AppearanceModeSchema = z.enum(["system", "light", "dark"]);
export type AppearanceMode = z.infer<typeof AppearanceModeSchema>;

export const AppearanceColorSchemeSchema = z.enum(["light", "dark"]);
export type AppearanceColorScheme = z.infer<typeof AppearanceColorSchemeSchema>;

export const APPEARANCE_FONT_SIZE_LIMITS = {
  uiFontSize: { min: 10, max: 24 },
  editorFontSize: { min: 10, max: 40 },
  codeFontSize: { min: 10, max: 24 }
} as const;

export const DEFAULT_APPEARANCE_UI_FONT_SIZE = 14;
export const DEFAULT_APPEARANCE_CODE_FONT_SIZE = 13;

export const APPEARANCE_CUSTOM_FONT_MAX_FILES_PER_INSTALL = 20;
export const APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const APPEARANCE_CUSTOM_FONT_MAX_COUNT = 100;
export const APPEARANCE_CUSTOM_FONT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export const APPEARANCE_CUSTOM_FONT_DISPLAY_NAME_MAX_LENGTH = 100;

export const AppearanceCustomFontIdSchema = z
  .string()
  .regex(/^font_[\da-f]{64}$/u);
export type AppearanceCustomFontId = z.infer<
  typeof AppearanceCustomFontIdSchema
>;

export const AppearanceCustomFontFormatSchema = z.enum(["ttf", "otf"]);
export type AppearanceCustomFontFormat = z.infer<
  typeof AppearanceCustomFontFormatSchema
>;

export const AppearanceCustomFontSchema = z.object({
  id: AppearanceCustomFontIdSchema,
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(APPEARANCE_CUSTOM_FONT_DISPLAY_NAME_MAX_LENGTH),
  format: AppearanceCustomFontFormatSchema,
  byteSize: z
    .number()
    .int()
    .positive()
    .max(APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES),
  installedAt: z.string().datetime()
});
export type AppearanceCustomFont = z.infer<typeof AppearanceCustomFontSchema>;

export const AppearanceFontCatalogSnapshotSchema = z.object({
  fonts: z
    .array(AppearanceCustomFontSchema)
    .max(APPEARANCE_CUSTOM_FONT_MAX_COUNT)
});
export type AppearanceFontCatalogSnapshot = z.infer<
  typeof AppearanceFontCatalogSnapshotSchema
>;

export const AppearanceFontInstallFailureCodeSchema = z.enum([
  "not_regular_file",
  "unsupported_format",
  "invalid_font",
  "file_too_large",
  "catalog_limit",
  "read_failed"
]);
export type AppearanceFontInstallFailureCode = z.infer<
  typeof AppearanceFontInstallFailureCodeSchema
>;

export const AppearanceFontInstallFailureSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(APPEARANCE_CUSTOM_FONT_DISPLAY_NAME_MAX_LENGTH),
  code: AppearanceFontInstallFailureCodeSchema
});
export type AppearanceFontInstallFailure = z.infer<
  typeof AppearanceFontInstallFailureSchema
>;

export const AppearanceFontInstallResultSchema = z.discriminatedUnion(
  "status",
  [
    z.object({ status: z.literal("canceled") }),
    z.object({
      status: z.literal("completed"),
      catalog: AppearanceFontCatalogSnapshotSchema,
      installedIds: z.array(AppearanceCustomFontIdSchema),
      duplicateIds: z.array(AppearanceCustomFontIdSchema),
      rejected: z.array(AppearanceFontInstallFailureSchema)
    })
  ]
);
export type AppearanceFontInstallResult = z.infer<
  typeof AppearanceFontInstallResultSchema
>;

export const APPEARANCE_UI_FONT_FAMILIES = ["system", "sans", "yuan"] as const;
export const AppearanceUiFontFamilySchema = z.enum(APPEARANCE_UI_FONT_FAMILIES);
export type AppearanceUiFontFamily = z.infer<
  typeof AppearanceUiFontFamilySchema
>;
export const AppearanceUiFontSelectionSchema = z.union([
  AppearanceUiFontFamilySchema,
  AppearanceCustomFontIdSchema
]);
export type AppearanceUiFontSelection = z.infer<
  typeof AppearanceUiFontSelectionSchema
>;

export const APPEARANCE_EDITOR_FONT_FAMILIES = [
  "song",
  "kai",
  "fangsong",
  "sans",
  "yuan"
] as const;
export const AppearanceEditorFontFamilySchema = z.enum(
  APPEARANCE_EDITOR_FONT_FAMILIES
);
export type AppearanceEditorFontFamily = z.infer<
  typeof AppearanceEditorFontFamilySchema
>;
export const AppearanceEditorFontSelectionSchema = z.union([
  AppearanceEditorFontFamilySchema,
  AppearanceCustomFontIdSchema
]);
export type AppearanceEditorFontSelection = z.infer<
  typeof AppearanceEditorFontSelectionSchema
>;

export const DEFAULT_APPEARANCE_UI_FONT_FAMILY: AppearanceUiFontFamily =
  "system";
export const DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY: AppearanceEditorFontFamily =
  "song";

export const APPEARANCE_FONT_FAMILY_LABELS = {
  system: "系统默认",
  sans: "黑体",
  song: "宋体",
  kai: "楷体",
  fangsong: "仿宋",
  yuan: "圆体"
} as const;

export const APPEARANCE_UI_FONT_STACKS = {
  system:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  sans: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif',
  yuan: '"Yuanti SC", "YouYuan", "PingFang SC", "Microsoft YaHei", sans-serif'
} as const satisfies Record<AppearanceUiFontFamily, string>;

export const APPEARANCE_EDITOR_FONT_STACKS = {
  song: '"Songti SC", "SimSun", "Noto Serif SC", Georgia, serif',
  kai: '"Kaiti SC", "STKaiti", "KaiTi", serif',
  fangsong: '"STFangsong", "FangSong", "KaiTi", serif',
  sans: APPEARANCE_UI_FONT_STACKS.sans,
  yuan: APPEARANCE_UI_FONT_STACKS.yuan
} as const satisfies Record<AppearanceEditorFontFamily, string>;

export interface AppearanceFontFamilyOption<T extends string> {
  value: T;
  label: string;
  stack: string;
}

export function isAppearanceCustomFontId(
  value: unknown
): value is AppearanceCustomFontId {
  return AppearanceCustomFontIdSchema.safeParse(value).success;
}

export function appearanceCustomFontCssFamily(
  rawId: AppearanceCustomFontId
): string {
  const id = AppearanceCustomFontIdSchema.parse(rawId);
  return `DeepWriteCustom_${id.slice("font_".length)}`;
}

export function appearanceCustomFontSourceUrl(
  rawId: AppearanceCustomFontId
): string {
  const id = AppearanceCustomFontIdSchema.parse(rawId);
  return `deepwrite-font://asset/${id}`;
}

export function resolveAppearanceUiFontStack(
  family: string | undefined
): string {
  if (isAppearanceCustomFontId(family)) {
    return `"${appearanceCustomFontCssFamily(family)}", ${APPEARANCE_UI_FONT_STACKS[DEFAULT_APPEARANCE_UI_FONT_FAMILY]}`;
  }
  if (family && family in APPEARANCE_UI_FONT_STACKS) {
    return APPEARANCE_UI_FONT_STACKS[family as AppearanceUiFontFamily];
  }
  return APPEARANCE_UI_FONT_STACKS[DEFAULT_APPEARANCE_UI_FONT_FAMILY];
}

export function resolveAppearanceEditorFontStack(
  family: string | undefined
): string {
  if (isAppearanceCustomFontId(family)) {
    return `"${appearanceCustomFontCssFamily(family)}", ${APPEARANCE_EDITOR_FONT_STACKS[DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY]}`;
  }
  if (family && family in APPEARANCE_EDITOR_FONT_STACKS) {
    return APPEARANCE_EDITOR_FONT_STACKS[family as AppearanceEditorFontFamily];
  }
  return APPEARANCE_EDITOR_FONT_STACKS[DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY];
}

export function listAppearanceUiFontFamilyOptions(): Array<
  AppearanceFontFamilyOption<AppearanceUiFontFamily>
> {
  return APPEARANCE_UI_FONT_FAMILIES.map((value) => ({
    value,
    label: APPEARANCE_FONT_FAMILY_LABELS[value],
    stack: APPEARANCE_UI_FONT_STACKS[value]
  }));
}

export function listAppearanceEditorFontFamilyOptions(): Array<
  AppearanceFontFamilyOption<AppearanceEditorFontFamily>
> {
  return APPEARANCE_EDITOR_FONT_FAMILIES.map((value) => ({
    value,
    label: APPEARANCE_FONT_FAMILY_LABELS[value],
    stack: APPEARANCE_EDITOR_FONT_STACKS[value]
  }));
}

const HexColorSchema = z
  .string()
  .regex(/^#[\da-f]{6}$/iu, "颜色必须是 6 位十六进制值")
  .transform((value) => value.toUpperCase());

function fontSizeSchema(limits: { min: number; max: number }) {
  return z
    .number()
    .finite()
    .min(limits.min)
    .max(limits.max)
    .transform((value) => Math.round(value * 2) / 2);
}

export const AppearanceThemeConfigSchema = z.object({
  preset: z.string().trim().min(1),
  accent: HexColorSchema,
  background: HexColorSchema,
  foreground: HexColorSchema,
  uiFontSize: fontSizeSchema(APPEARANCE_FONT_SIZE_LIMITS.uiFontSize),
  editorFontSize: fontSizeSchema(
    APPEARANCE_FONT_SIZE_LIMITS.editorFontSize
  ).default(15),
  codeFontSize: fontSizeSchema(APPEARANCE_FONT_SIZE_LIMITS.codeFontSize),
  translucentSidebar: z.boolean()
});
export type AppearanceThemeConfig = z.infer<typeof AppearanceThemeConfigSchema>;

export const AppearanceSettingsSchema = z.object({
  mode: AppearanceModeSchema,
  light: AppearanceThemeConfigSchema,
  dark: AppearanceThemeConfigSchema,
  uiFontFamily: AppearanceUiFontSelectionSchema.default(
    DEFAULT_APPEARANCE_UI_FONT_FAMILY
  ),
  editorFontFamily: AppearanceEditorFontSelectionSchema.default(
    DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY
  )
});
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>;

export const AppearanceSettingsSnapshotSchema = z.object({
  persisted: z.boolean(),
  settings: AppearanceSettingsSchema
});
export type AppearanceSettingsSnapshot = z.infer<
  typeof AppearanceSettingsSnapshotSchema
>;

export function createDefaultAppearanceTheme(
  scheme: AppearanceColorScheme
): AppearanceThemeConfig {
  if (scheme === "dark") {
    return {
      preset: "codex",
      accent: "#5EACFF",
      background: "#17191C",
      foreground: "#F3F4F6",
      uiFontSize: DEFAULT_APPEARANCE_UI_FONT_SIZE,
      editorFontSize: 15,
      codeFontSize: DEFAULT_APPEARANCE_CODE_FONT_SIZE,
      translucentSidebar: true
    };
  }
  return {
    preset: "codex",
    accent: "#339CFF",
    background: "#FFFFFF",
    foreground: "#1A1C1F",
    uiFontSize: DEFAULT_APPEARANCE_UI_FONT_SIZE,
    editorFontSize: 15,
    codeFontSize: DEFAULT_APPEARANCE_CODE_FONT_SIZE,
    translucentSidebar: true
  };
}

export function createDefaultAppearanceSettings(): AppearanceSettings {
  return {
    mode: "system",
    light: createDefaultAppearanceTheme("light"),
    dark: createDefaultAppearanceTheme("dark"),
    uiFontFamily: DEFAULT_APPEARANCE_UI_FONT_FAMILY,
    editorFontFamily: DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY
  };
}

export const AppearanceListCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("appearance.list"),
  payload: z.object({})
});

export const AppearanceSaveCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("appearance.save"),
  payload: AppearanceSettingsSchema
});

export const AppearanceFontsListCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("appearance.fonts.list"),
    payload: z.object({}).strict()
  });

export const AppearanceFontsInstallCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("appearance.fonts.install"),
    payload: z.object({}).strict()
  });

export const AppearanceFontsRemoveCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("appearance.fonts.remove"),
    payload: z.object({ id: AppearanceCustomFontIdSchema }).strict()
  });

export const AppearanceFontRemoveResultSchema = z.object({
  removed: z.boolean(),
  catalog: AppearanceFontCatalogSnapshotSchema,
  appearance: AppearanceSettingsSnapshotSchema
});
export type AppearanceFontRemoveResult = z.infer<
  typeof AppearanceFontRemoveResultSchema
>;
