import { t } from "../i18n";
import { computed, nextTick, reactive, readonly, watch } from "vue";
import {
  AppearanceEditorFontSelectionSchema,
  AppearanceSettingsSchema,
  AppearanceUiFontSelectionSchema,
  createDefaultAppearanceSettings,
  isAppearanceCustomFontId,
  type AppearanceColorScheme,
  type AppearanceEditorFontSelection,
  type AppearanceMode,
  type AppearanceSettings,
  type AppearanceThemeConfig,
  type AppearanceUiFontSelection
} from "@deepwrite/contracts/renderer";
import {
  applyAppearanceThemeToDocument,
  defaultAppearanceTheme,
  FONT_SIZE_LIMITS,
  sanitizeAppearanceTheme,
  serializeAppearanceThemeFile,
  themePresets,
  type ThemePreset
} from "./appearanceThemeRuntime";
import {
  ensureAppearanceFontLoaded,
  hydrateAppearanceFontCatalog
} from "./useAppearanceFonts";

export type { AppearanceMode };
export type ColorScheme = AppearanceColorScheme;
export type ThemeConfig = AppearanceThemeConfig;
export { FONT_SIZE_LIMITS, themePresets };
export { parseAppearanceThemeFile as parseThemeFile } from "./appearanceThemeRuntime";
export type { ThemePreset };

interface AppearanceState {
  startupWindowSize?: AppearanceSettings["startupWindowSize"];
  mode: AppearanceMode;
  systemScheme: ColorScheme;
  light: ThemeConfig;
  dark: ThemeConfig;
  uiFontFamily: AppearanceUiFontSelection;
  editorFontFamily: AppearanceEditorFontSelection;
}

const LEGACY_STORAGE_KEY = "deepwrite.appearance.v1";
const PERSIST_DEBOUNCE_MS = 300;
let uiFontSelectionIntent = 0;
let editorFontSelectionIntent = 0;

function captureSettings(): AppearanceSettings {
  return AppearanceSettingsSchema.parse({
    startupWindowSize: state.startupWindowSize,
    mode: state.mode,
    light: state.light,
    dark: state.dark,
    uiFontFamily: state.uiFontFamily,
    editorFontFamily: state.editorFontFamily
  });
}

function applySettings(settings: AppearanceSettings): void {
  uiFontSelectionIntent += 1;
  editorFontSelectionIntent += 1;
  suppressPersist = true;
  state.startupWindowSize = settings.startupWindowSize;
  state.mode = settings.mode;
  state.uiFontFamily = settings.uiFontFamily;
  state.editorFontFamily = settings.editorFontFamily;
  Object.assign(state.light, settings.light);
  Object.assign(state.dark, settings.dark);
  suppressPersist = false;
  applyToDocument();
}

function readLegacyStoredState(systemScheme: ColorScheme): AppearanceState {
  const defaults = createDefaultAppearanceSettings();
  const fallback: AppearanceState = {
    mode: defaults.mode,
    systemScheme,
    light: defaults.light,
    dark: defaults.dark,
    uiFontFamily: defaults.uiFontFamily,
    editorFontFamily: defaults.editorFontFamily
  };
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    const settings = AppearanceSettingsSchema.safeParse({
      startupWindowSize: parsed.startupWindowSize,
      mode: parsed.mode,
      light: parsed.light,
      dark: parsed.dark,
      uiFontFamily: parsed.uiFontFamily,
      editorFontFamily: parsed.editorFontFamily
    });
    if (settings.success) {
      return {
        startupWindowSize: settings.data.startupWindowSize,
        mode: settings.data.mode,
        systemScheme,
        light: settings.data.light,
        dark: settings.data.dark,
        uiFontFamily: settings.data.uiFontFamily,
        editorFontFamily: settings.data.editorFontFamily
      };
    }
    return {
      mode:
        parsed.mode === "light" ||
        parsed.mode === "dark" ||
        parsed.mode === "system"
          ? parsed.mode
          : fallback.mode,
      systemScheme,
      light: sanitizeAppearanceTheme(parsed.light, "light"),
      dark: sanitizeAppearanceTheme(parsed.dark, "dark"),
      uiFontFamily: sanitizeUiFontFamily(
        parsed.uiFontFamily,
        fallback.uiFontFamily
      ),
      editorFontFamily: sanitizeEditorFontFamily(
        parsed.editorFontFamily,
        fallback.editorFontFamily
      )
    };
  } catch {
    return fallback;
  }
}

function clearLegacyStorage(): void {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore quota / privacy mode failures.
  }
}

function persistToLegacyStorage(): void {
  try {
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        startupWindowSize: state.startupWindowSize,
        mode: state.mode,
        light: state.light,
        dark: state.dark,
        uiFontFamily: state.uiFontFamily,
        editorFontFamily: state.editorFontFamily
      })
    );
  } catch {
    // The live theme still works when storage is unavailable.
  }
}

const media = window.matchMedia("(prefers-color-scheme: dark)");
const state = reactive<AppearanceState>(
  readLegacyStoredState(media.matches ? "dark" : "light")
);
const resolvedScheme = computed<ColorScheme>(() =>
  state.mode === "system" ? state.systemScheme : state.mode
);
const activeTheme = computed(() => state[resolvedScheme.value]);
let initialized = false;
let suppressPersist = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persistChain: Promise<void> = Promise.resolve();
let persistFailed = false;
let hydratePromise: Promise<void> | undefined;

function applyToDocument(): void {
  applyAppearanceThemeToDocument({
    scheme: resolvedScheme.value,
    theme: activeTheme.value,
    uiFontFamily: state.uiFontFamily,
    editorFontFamily: state.editorFontFamily
  });
}

function queueDesktopPersist(settings: AppearanceSettings): void {
  const api = window.deepwrite?.appearance;
  if (!api) {
    persistToLegacyStorage();
    return;
  }
  persistChain = persistChain
    .catch(() => undefined)
    .then(async () => {
      await api.save(settings);
      persistFailed = false;
      clearLegacyStorage();
    })
    .catch(() => {
      persistFailed = true;
      persistToLegacyStorage();
    });
}

function persist(): void {
  if (typeof window === "undefined") return;
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    if (typeof window === "undefined") return;
    queueDesktopPersist(captureSettings());
  }, PERSIST_DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  await nextTick();
  if (persistTimer !== undefined || persistFailed) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
    queueDesktopPersist(captureSettings());
  }
  let pending: Promise<void>;
  do {
    pending = persistChain;
    await pending;
  } while (pending !== persistChain);
  if (persistFailed) {
    throw new Error(t("workspace.builtins.appearancePending"));
  }
}

async function normalizeLoadedFontSelections(
  settings: AppearanceSettings
): Promise<AppearanceSettings> {
  const defaults = createDefaultAppearanceSettings();
  let uiFontFamily = settings.uiFontFamily;
  let editorFontFamily = settings.editorFontFamily;

  if (isAppearanceCustomFontId(uiFontFamily)) {
    try {
      await ensureAppearanceFontLoaded(uiFontFamily);
    } catch {
      uiFontFamily = defaults.uiFontFamily;
    }
  }
  if (isAppearanceCustomFontId(editorFontFamily)) {
    try {
      await ensureAppearanceFontLoaded(editorFontFamily);
    } catch {
      editorFontFamily = defaults.editorFontFamily;
    }
  }
  return AppearanceSettingsSchema.parse({
    ...settings,
    uiFontFamily,
    editorFontFamily
  });
}

function fontSelectionsChanged(
  before: AppearanceSettings,
  after: AppearanceSettings
): boolean {
  return (
    before.uiFontFamily !== after.uiFontFamily ||
    before.editorFontFamily !== after.editorFontFamily
  );
}

async function applyHydratedSettings(
  settings: AppearanceSettings,
  persistRepair = false
): Promise<void> {
  const normalized = await normalizeLoadedFontSelections(settings);
  applySettings(normalized);
  if (persistRepair && fontSelectionsChanged(settings, normalized)) {
    await window.deepwrite?.appearance.save(normalized);
  }
}

async function applyDesktopSettings(
  settings: AppearanceSettings
): Promise<void> {
  await applyHydratedSettings(settings, true);
}

async function hydrateFromDesktop(): Promise<void> {
  const api = window.deepwrite?.appearance;
  if (!api) return;
  try {
    const [snapshot] = await Promise.all([
      api.list(),
      hydrateAppearanceFontCatalog()
    ]);
    if (!snapshot.persisted) {
      const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyRaw) {
        const legacy = AppearanceSettingsSchema.safeParse(
          JSON.parse(legacyRaw) as unknown
        );
        if (legacy.success) {
          const normalized = await normalizeLoadedFontSelections(legacy.data);
          applySettings(normalized);
          await api.save(normalized);
          clearLegacyStorage();
          return;
        }
      }
      clearLegacyStorage();
      return;
    }
    await applyHydratedSettings(snapshot.settings, true);
    clearLegacyStorage();
  } catch {
    // Keep the bootstrapped theme (legacy localStorage or defaults) if hydration fails.
  }
}

function initialize(): void {
  if (initialized) return;
  initialized = true;
  media.addEventListener("change", handleSystemSchemeChange);
  watch(
    state,
    () => {
      applyToDocument();
      if (!suppressPersist) persist();
    },
    { deep: true }
  );
  applyToDocument();
  hydratePromise = hydrateFromDesktop();
}

function handleSystemSchemeChange(event: MediaQueryListEvent): void {
  state.systemScheme = event.matches ? "dark" : "light";
}

export function setAppearanceMode(mode: AppearanceMode): void {
  state.mode = mode;
}

function sanitizeUiFontFamily(
  value: unknown,
  fallback: AppearanceUiFontSelection
): AppearanceUiFontSelection {
  const parsed = AppearanceUiFontSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function sanitizeEditorFontFamily(
  value: unknown,
  fallback: AppearanceEditorFontSelection
): AppearanceEditorFontSelection {
  const parsed = AppearanceEditorFontSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export async function setUiFontFamily(family: string): Promise<void> {
  const intent = ++uiFontSelectionIntent;
  const parsed = AppearanceUiFontSelectionSchema.safeParse(family);
  if (!parsed.success || parsed.data === state.uiFontFamily) return;
  if (isAppearanceCustomFontId(parsed.data)) {
    await ensureAppearanceFontLoaded(parsed.data);
  }
  if (intent !== uiFontSelectionIntent) return;
  state.uiFontFamily = parsed.data;
}

export async function setEditorFontFamily(family: string): Promise<void> {
  const intent = ++editorFontSelectionIntent;
  const parsed = AppearanceEditorFontSelectionSchema.safeParse(family);
  if (!parsed.success || parsed.data === state.editorFontFamily) return;
  if (isAppearanceCustomFontId(parsed.data)) {
    await ensureAppearanceFontLoaded(parsed.data);
  }
  if (intent !== editorFontSelectionIntent) return;
  state.editorFontFamily = parsed.data;
}

export function updateTheme(
  scheme: ColorScheme,
  patch: Partial<ThemeConfig>
): void {
  Object.assign(state[scheme], patch);
}

export function applyThemePreset(scheme: ColorScheme, presetId: string): void {
  const preset = themePresets.find((item) => item.id === presetId);
  if (!preset) return;
  Object.assign(state[scheme], { preset: preset.id, ...preset[scheme] });
}

export function importTheme(scheme: ColorScheme, value: unknown): void {
  Object.assign(state[scheme], sanitizeAppearanceTheme(value, scheme), {
    preset: "custom"
  });
}

export function resetTheme(scheme: ColorScheme): void {
  Object.assign(state[scheme], defaultAppearanceTheme(scheme));
}

async function saveStartupWindowSize(capture: boolean): Promise<void> {
  await flush();
  const api = window.deepwrite?.appearance;
  if (!api) throw new Error("Desktop appearance API unavailable");
  const settings = captureSettings();
  if (!capture) settings.startupWindowSize = null;
  const snapshot = await api.save(settings, {
    captureCurrentWindowSize: capture
  });
  state.startupWindowSize = snapshot.settings.startupWindowSize;
}

export function useAppearance() {
  initialize();
  return {
    state: readonly(state),
    resolvedScheme,
    activeTheme,
    setMode: setAppearanceMode,
    setUiFontFamily,
    setEditorFontFamily,
    applyDesktopSettings,
    updateTheme,
    applyPreset: applyThemePreset,
    importTheme,
    resetTheme,
    flush,
    saveStartupWindowSize,
    whenReady: () => hydratePromise ?? Promise.resolve()
  };
}

export function serializeTheme(scheme: ColorScheme): string {
  return serializeAppearanceThemeFile(scheme, state[scheme]);
}
