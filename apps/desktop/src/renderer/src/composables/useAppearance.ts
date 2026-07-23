import { computed, reactive, readonly, watch } from "vue";

export type AppearanceMode = "system" | "light" | "dark";
export type ColorScheme = "light" | "dark";

export interface ThemeConfig {
  preset: string;
  accent: string;
  background: string;
  foreground: string;
  uiFontSize: number;
  codeFontSize: number;
  translucentSidebar: boolean;
}

interface AppearanceState {
  mode: AppearanceMode;
  systemScheme: ColorScheme;
  light: ThemeConfig;
  dark: ThemeConfig;
}

export interface ThemePreset {
  id: string;
  label: string;
  light: Pick<ThemeConfig, "accent" | "background" | "foreground">;
  dark: Pick<ThemeConfig, "accent" | "background" | "foreground">;
}

const STORAGE_KEY = "deepwrite.appearance.v1";
export const FONT_SIZE_LIMITS = {
  uiFontSize: { min: 10, max: 24 },
  codeFontSize: { min: 10, max: 24 }
} as const;

const DEFAULT_UI_FONT_SIZE = 14;
const DEFAULT_CODE_FONT_SIZE = 13;

export const themePresets: ThemePreset[] = [
  {
    id: "codex",
    label: "Codex",
    light: { accent: "#339CFF", background: "#FFFFFF", foreground: "#1A1C1F" },
    dark: { accent: "#5EACFF", background: "#17191C", foreground: "#F3F4F6" }
  },
  {
    id: "paper",
    label: "暖纸",
    light: { accent: "#B5683B", background: "#FBF7EF", foreground: "#2E2823" },
    dark: { accent: "#E49B66", background: "#201C19", foreground: "#F7EFE5" }
  },
  {
    id: "ocean",
    label: "海雾",
    light: { accent: "#257F8B", background: "#F4FAFA", foreground: "#193135" },
    dark: { accent: "#5CC3CF", background: "#102124", foreground: "#E5F3F4" }
  }
];

function defaultTheme(scheme: ColorScheme): ThemeConfig {
  return {
    preset: "codex",
    ...themePresets[0]![scheme],
    uiFontSize: DEFAULT_UI_FONT_SIZE,
    codeFontSize: DEFAULT_CODE_FONT_SIZE,
    translucentSidebar: true
  };
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
}

function sanitizeFontSize(
  value: unknown,
  fallback: number,
  limits: { min: number; max: number }
): number {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= limits.min && value <= limits.max
    ? Math.round(value * 2) / 2
    : fallback;
}

function sanitizeTheme(value: unknown, scheme: ColorScheme): ThemeConfig {
  const fallback = defaultTheme(scheme);
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<ThemeConfig>;
  return {
    preset: typeof candidate.preset === "string" ? candidate.preset : fallback.preset,
    accent: isHexColor(candidate.accent) ? candidate.accent.toUpperCase() : fallback.accent,
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

function readStoredState(systemScheme: ColorScheme): AppearanceState {
  const fallback: AppearanceState = {
    mode: "system",
    systemScheme,
    light: defaultTheme("light"),
    dark: defaultTheme("dark")
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AppearanceState>;
    return {
      mode: parsed.mode === "light" || parsed.mode === "dark" || parsed.mode === "system"
        ? parsed.mode
        : fallback.mode,
      systemScheme,
      light: sanitizeTheme(parsed.light, "light"),
      dark: sanitizeTheme(parsed.dark, "dark")
    };
  } catch {
    return fallback;
  }
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

function mix(background: string, foreground: string, foregroundRatio: number): string {
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

const media = window.matchMedia("(prefers-color-scheme: dark)");
const state = reactive<AppearanceState>(readStoredState(media.matches ? "dark" : "light"));
const resolvedScheme = computed<ColorScheme>(() =>
  state.mode === "system" ? state.systemScheme : state.mode
);
const activeTheme = computed(() => state[resolvedScheme.value]);
let initialized = false;

function applyToDocument(): void {
  const scheme = resolvedScheme.value;
  const theme = activeTheme.value;
  const root = document.documentElement;
  root.dataset.theme = scheme;
  root.style.colorScheme = scheme;
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-contrast", readableAccentText(theme.accent));
  root.style.setProperty("--accent-soft", rgba(theme.accent, scheme === "dark" ? 0.18 : 0.12));
  root.style.setProperty("--theme-background", theme.background);
  root.style.setProperty("--theme-foreground", theme.foreground);
  root.style.setProperty("--surface-main", theme.background);
  root.style.setProperty("--surface-raised", mix(theme.background, theme.foreground, scheme === "dark" ? 0.055 : 0.018));
  root.style.setProperty("--surface-muted", mix(theme.background, theme.foreground, scheme === "dark" ? 0.09 : 0.045));
  root.style.setProperty("--surface-hover", mix(theme.background, theme.foreground, scheme === "dark" ? 0.14 : 0.085));
  root.style.setProperty("--surface-selected", mix(theme.background, theme.foreground, scheme === "dark" ? 0.2 : 0.12));
  root.style.setProperty("--theme-line", mix(theme.background, theme.foreground, scheme === "dark" ? 0.2 : 0.14));
  root.style.setProperty("--theme-line-soft", mix(theme.background, theme.foreground, scheme === "dark" ? 0.13 : 0.075));
  root.style.setProperty("--text-primary", theme.foreground);
  root.style.setProperty("--text-secondary", mix(theme.background, theme.foreground, scheme === "dark" ? 0.72 : 0.67));
  root.style.setProperty("--text-tertiary", mix(theme.background, theme.foreground, scheme === "dark" ? 0.52 : 0.5));
  root.style.setProperty("--ui-font-size", `${theme.uiFontSize}px`);
  root.style.setProperty("--code-font-size", `${theme.codeFontSize}px`);
  root.style.setProperty(
    "--sidebar-surface",
    theme.translucentSidebar
      ? mixRgba(theme.background, theme.foreground, scheme === "dark" ? 0.08 : 0.035, 0.84)
      : mix(theme.background, theme.foreground, scheme === "dark" ? 0.08 : 0.035)
  );
  root.dataset.translucentSidebar = String(theme.translucentSidebar);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme.background);
}

function persist(): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mode: state.mode, light: state.light, dark: state.dark })
    );
  } catch {
    // The live theme still works when storage is unavailable (for example in a restricted preview).
  }
}

function initialize(): void {
  if (initialized) return;
  initialized = true;
  media.addEventListener("change", handleSystemSchemeChange);
  watch(state, () => {
    applyToDocument();
    persist();
  }, { deep: true });
  applyToDocument();
}

function handleSystemSchemeChange(event: MediaQueryListEvent): void {
  state.systemScheme = event.matches ? "dark" : "light";
}

export function setAppearanceMode(mode: AppearanceMode): void {
  state.mode = mode;
}

export function updateTheme(scheme: ColorScheme, patch: Partial<ThemeConfig>): void {
  Object.assign(state[scheme], patch);
}

export function applyThemePreset(scheme: ColorScheme, presetId: string): void {
  const preset = themePresets.find((item) => item.id === presetId);
  if (!preset) return;
  Object.assign(state[scheme], { preset: preset.id, ...preset[scheme] });
}

export function importTheme(scheme: ColorScheme, value: unknown): void {
  Object.assign(state[scheme], sanitizeTheme(value, scheme), { preset: "custom" });
}

export function resetTheme(scheme: ColorScheme): void {
  Object.assign(state[scheme], defaultTheme(scheme));
}

export function useAppearance() {
  initialize();
  return {
    state: readonly(state),
    resolvedScheme,
    activeTheme,
    setMode: setAppearanceMode,
    updateTheme,
    applyPreset: applyThemePreset,
    importTheme,
    resetTheme
  };
}

export function serializeTheme(scheme: ColorScheme): string {
  return JSON.stringify({ version: 2, scheme, theme: state[scheme] }, null, 2);
}

export function parseThemeFile(value: string): { scheme?: ColorScheme; theme: unknown } {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("主题文件格式无效");
  const record = parsed as { scheme?: unknown; theme?: unknown };
  const scheme = record.scheme === "light" || record.scheme === "dark" ? record.scheme : undefined;
  return {
    ...(scheme ? { scheme } : {}),
    theme: record.theme ?? parsed
  };
}
