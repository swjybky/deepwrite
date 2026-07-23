import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const AppearanceModeSchema = z.enum(["system", "light", "dark"]);
export type AppearanceMode = z.infer<typeof AppearanceModeSchema>;

export const AppearanceColorSchemeSchema = z.enum(["light", "dark"]);
export type AppearanceColorScheme = z.infer<typeof AppearanceColorSchemeSchema>;

export const APPEARANCE_FONT_SIZE_LIMITS = {
  uiFontSize: { min: 10, max: 24 },
  codeFontSize: { min: 10, max: 24 }
} as const;

export const DEFAULT_APPEARANCE_UI_FONT_SIZE = 14;
export const DEFAULT_APPEARANCE_CODE_FONT_SIZE = 13;

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
  codeFontSize: fontSizeSchema(APPEARANCE_FONT_SIZE_LIMITS.codeFontSize),
  translucentSidebar: z.boolean()
});
export type AppearanceThemeConfig = z.infer<typeof AppearanceThemeConfigSchema>;

export const AppearanceSettingsSchema = z.object({
  mode: AppearanceModeSchema,
  light: AppearanceThemeConfigSchema,
  dark: AppearanceThemeConfigSchema
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
    codeFontSize: DEFAULT_APPEARANCE_CODE_FONT_SIZE,
    translucentSidebar: true
  };
}

export function createDefaultAppearanceSettings(): AppearanceSettings {
  return {
    mode: "system",
    light: createDefaultAppearanceTheme("light"),
    dark: createDefaultAppearanceTheme("dark")
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
