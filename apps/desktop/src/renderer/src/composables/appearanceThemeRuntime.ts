import { createScopedTranslator } from "../i18n";
import {
  APPEARANCE_FONT_SIZE_LIMITS,
  createDefaultAppearanceTheme,
  resolveAppearanceEditorFontStack,
  resolveAppearanceUiFontStack,
  type AppearanceColorScheme,
  type AppearanceEditorFontSelection,
  type AppearanceThemeConfig,
  type AppearanceUiFontSelection
} from "@deepwrite/contracts/renderer";

const t = createScopedTranslator("workspace.appearanceThemeRuntime");

export interface ThemePreset {
  id: string;
  label: string;
  light: Pick<AppearanceThemeConfig, "accent" | "background" | "foreground">;
  dark: Pick<AppearanceThemeConfig, "accent" | "background" | "foreground">;
}

export const FONT_SIZE_LIMITS = APPEARANCE_FONT_SIZE_LIMITS;

export const themePresets: ThemePreset[] = [
  {
    id: "codex",
    label: "Codex",
    light: { accent: "#339CFF", background: "#FFFFFF", foreground: "#1A1C1F" },
    dark: { accent: "#5EACFF", background: "#17191C", foreground: "#F3F4F6" }
  },
  {
    id: "paper",
    get label() {
      return t("warmPaper");
    },
    light: { accent: "#B5683B", background: "#FBF7EF", foreground: "#2E2823" },
    dark: { accent: "#E49B66", background: "#201C19", foreground: "#F7EFE5" }
  },
  {
    id: "ocean",
    get label() {
      return t("seaMist");
    },
    light: { accent: "#257F8B", background: "#F4FAFA", foreground: "#193135" },
    dark: { accent: "#5CC3CF", background: "#102124", foreground: "#E5F3F4" }
  },
  {
    id: "eye-care",
    get label() {
      return t("eyeCare");
    },
    // 豆沙绿底配低饱和墨绿字；深色版避开纯黑纯白，降低长时间阅读的刺眼感。
    light: { accent: "#2E7048", background: "#CCE8CF", foreground: "#233428" },
    dark: { accent: "#6FBF88", background: "#1B2620", foreground: "#D5E3D7" }
  }
];

export function defaultAppearanceTheme(
  scheme: AppearanceColorScheme
): AppearanceThemeConfig {
  return createDefaultAppearanceTheme(scheme);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
}

function sanitizeFontSize(
  value: unknown,
  fallback: number,
  limits: { min: number; max: number }
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= limits.min &&
    value <= limits.max
    ? Math.round(value * 2) / 2
    : fallback;
}

export function sanitizeAppearanceTheme(
  value: unknown,
  scheme: AppearanceColorScheme
): AppearanceThemeConfig {
  const fallback = defaultAppearanceTheme(scheme);
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<AppearanceThemeConfig>;
  return {
    preset:
      typeof candidate.preset === "string" ? candidate.preset : fallback.preset,
    accent: isHexColor(candidate.accent)
      ? candidate.accent.toUpperCase()
      : fallback.accent,
    background: isHexColor(candidate.background)
      ? candidate.background.toUpperCase()
      : fallback.background,
    foreground: isHexColor(candidate.foreground)
      ? candidate.foreground.toUpperCase()
      : fallback.foreground,
    uiFontSize: sanitizeFontSize(
      candidate.uiFontSize,
      fallback.uiFontSize,
      FONT_SIZE_LIMITS.uiFontSize
    ),
    editorFontSize: sanitizeFontSize(
      candidate.editorFontSize,
      fallback.editorFontSize,
      FONT_SIZE_LIMITS.editorFontSize
    ),
    codeFontSize: sanitizeFontSize(
      candidate.codeFontSize,
      fallback.codeFontSize,
      FONT_SIZE_LIMITS.codeFontSize
    ),
    translucentSidebar:
      typeof candidate.translucentSidebar === "boolean"
        ? candidate.translucentSidebar
        : fallback.translucentSidebar
  };
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)
  ];
}

function mixChannels(
  background: string,
  foreground: string,
  foregroundRatio: number
): [number, number, number] {
  const bg = hexToRgb(background);
  const fg = hexToRgb(foreground);
  return bg.map((channel, index) =>
    Math.round(channel * (1 - foregroundRatio) + fg[index]! * foregroundRatio)
  ) as [number, number, number];
}

function mix(
  background: string,
  foreground: string,
  foregroundRatio: number
): string {
  return `rgb(${mixChannels(background, foreground, foregroundRatio).join(" ")})`;
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

function readableAccentText(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const perceivedBrightness = (r * 299 + g * 587 + b * 114) / 1000;
  return perceivedBrightness > 158 ? "#17191C" : "#FFFFFF";
}

function mixRgba(
  background: string,
  foreground: string,
  foregroundRatio: number,
  alpha: number
): string {
  return `rgb(${mixChannels(background, foreground, foregroundRatio).join(" ")} / ${alpha})`;
}

export function applyAppearanceThemeToDocument(input: {
  scheme: AppearanceColorScheme;
  theme: AppearanceThemeConfig;
  uiFontFamily: AppearanceUiFontSelection;
  editorFontFamily: AppearanceEditorFontSelection;
}): void {
  const { scheme, theme } = input;
  const root = document.documentElement;
  root.dataset.theme = scheme;
  root.style.colorScheme = scheme;
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-contrast", readableAccentText(theme.accent));
  root.style.setProperty(
    "--accent-soft",
    rgba(theme.accent, scheme === "dark" ? 0.18 : 0.12)
  );
  root.style.setProperty("--theme-background", theme.background);
  root.style.setProperty("--theme-foreground", theme.foreground);
  root.style.setProperty("--surface-main", theme.background);
  root.style.setProperty(
    "--surface-raised",
    mix(theme.background, theme.foreground, scheme === "dark" ? 0.055 : 0.018)
  );
  root.style.setProperty(
    "--surface-muted",
    mix(theme.background, theme.foreground, scheme === "dark" ? 0.09 : 0.045)
  );
  root.style.setProperty(
    "--surface-hover",
    mix(theme.background, theme.foreground, scheme === "dark" ? 0.14 : 0.085)
  );
  root.style.setProperty(
    "--surface-selected",
    mix(theme.background, theme.foreground, scheme === "dark" ? 0.2 : 0.12)
  );
  root.style.setProperty(
    "--theme-line",
    mix(theme.background, theme.foreground, scheme === "dark" ? 0.2 : 0.14)
  );
  root.style.setProperty(
    "--theme-line-soft",
    mix(theme.background, theme.foreground, scheme === "dark" ? 0.13 : 0.075)
  );
  root.style.setProperty("--text-primary", theme.foreground);
  root.style.setProperty(
    "--text-secondary",
    mix(theme.background, theme.foreground, scheme === "dark" ? 0.72 : 0.67)
  );
  root.style.setProperty(
    "--text-tertiary",
    mix(theme.background, theme.foreground, scheme === "dark" ? 0.52 : 0.5)
  );
  root.style.setProperty("--ui-font-size", `${theme.uiFontSize}px`);
  root.style.setProperty("--editor-font-size", `${theme.editorFontSize}px`);
  root.style.setProperty("--code-font-size", `${theme.codeFontSize}px`);
  root.style.setProperty(
    "--ui-font",
    resolveAppearanceUiFontStack(input.uiFontFamily)
  );
  root.style.setProperty(
    "--editor-font",
    resolveAppearanceEditorFontStack(input.editorFontFamily)
  );
  root.style.setProperty(
    "--sidebar-surface",
    theme.translucentSidebar
      ? mixRgba(
          theme.background,
          theme.foreground,
          scheme === "dark" ? 0.08 : 0.035,
          0.84
        )
      : mix(
          theme.background,
          theme.foreground,
          scheme === "dark" ? 0.08 : 0.035
        )
  );
  root.dataset.translucentSidebar = String(theme.translucentSidebar);
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme.background);
}

export function serializeAppearanceThemeFile(
  scheme: AppearanceColorScheme,
  theme: AppearanceThemeConfig
): string {
  return JSON.stringify({ version: 2, scheme, theme }, null, 2);
}

export function parseAppearanceThemeFile(value: string): {
  scheme?: AppearanceColorScheme;
  theme: unknown;
} {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(t("invalidThemeFileFormat"));
  }
  const record = parsed as { scheme?: unknown; theme?: unknown };
  const scheme =
    record.scheme === "light" || record.scheme === "dark"
      ? record.scheme
      : undefined;
  return {
    ...(scheme ? { scheme } : {}),
    theme: record.theme ?? parsed
  };
}
