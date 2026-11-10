import {
  DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY,
  DEFAULT_APPEARANCE_UI_FONT_FAMILY,
  AppearanceFontRemoveResultSchema,
  AppearanceSettingsSchema,
  isAppearanceCustomFontId,
  type AppearanceCustomFontId,
  type AppearanceFontCatalogSnapshot,
  type AppearanceFontInstallResult,
  type AppearanceFontRemoveResult,
  type AppearanceSettings,
  type AppearanceSettingsSnapshot
} from "@deepwrite/contracts";
import { AppearanceConfigStore } from "./appearance-config-store";
import { withConfigurationLock } from "./configuration-lock";
import {
  AppearanceFontStore,
  type ResolvedAppearanceFontAsset
} from "./appearance-font-store";

export interface AppearanceServiceDependencies {
  appearanceConfigStore?: AppearanceConfigStore;
  appearanceFontStore?: AppearanceFontStore;
}

export class AppearanceFontUnavailableError extends Error {
  readonly code = "appearance.custom_font_unavailable";

  constructor(readonly fontId: AppearanceCustomFontId) {
    super("所选本地字体不存在或已不可用。");
    this.name = "AppearanceFontUnavailableError";
  }
}

export class AppearanceService {
  private readonly configStore: AppearanceConfigStore;
  private readonly fontStore: AppearanceFontStore;
  private operationChain: Promise<void> = Promise.resolve();

  constructor(
    userDataPath: string,
    dependencies: AppearanceServiceDependencies = {}
  ) {
    this.configStore =
      dependencies.appearanceConfigStore ??
      new AppearanceConfigStore(userDataPath);
    this.fontStore =
      dependencies.appearanceFontStore ?? new AppearanceFontStore(userDataPath);
  }

  list(): Promise<AppearanceSettingsSnapshot> {
    return this.enqueue(async () => {
      const [appearance, catalog] = await Promise.all([
        this.configStore.list(),
        this.fontStore.list()
      ]);
      return this.reconcileAppearance(appearance, catalog);
    });
  }

  save(settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot> {
    return this.enqueue(async () => {
      const parsed = AppearanceSettingsSchema.parse(settings);
      const catalog = await this.fontStore.list();
      this.assertSelectionsAvailable(parsed, catalog);
      return this.configStore.save(parsed);
    });
  }

  listFonts(): Promise<AppearanceFontCatalogSnapshot> {
    return this.enqueue(async () => this.fontStore.list());
  }

  installFonts(
    sourcePaths: readonly string[]
  ): Promise<AppearanceFontInstallResult> {
    return this.enqueue(async () => this.fontStore.install(sourcePaths));
  }

  removeFont(id: AppearanceCustomFontId): Promise<AppearanceFontRemoveResult> {
    return this.enqueue(async () => {
      const [current] = await Promise.all([
        this.configStore.list(),
        this.fontStore.list()
      ]);
      const uiUsesRemovedFont = current.settings.uiFontFamily === id;
      const editorUsesRemovedFont = current.settings.editorFontFamily === id;
      const appearance =
        uiUsesRemovedFont || editorUsesRemovedFont
          ? await this.configStore.save({
              ...current.settings,
              uiFontFamily: uiUsesRemovedFont
                ? DEFAULT_APPEARANCE_UI_FONT_FAMILY
                : current.settings.uiFontFamily,
              editorFontFamily: editorUsesRemovedFont
                ? DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY
                : current.settings.editorFontFamily
            })
          : current;
      const removal = await this.fontStore.remove(id);
      return AppearanceFontRemoveResultSchema.parse({
        removed: removal.removed,
        catalog: removal.catalog,
        appearance
      });
    });
  }

  resolveFontAsset(rawId: string): Promise<ResolvedAppearanceFontAsset | null> {
    return this.enqueue(async () => this.fontStore.resolveAsset(rawId));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationChain.then(() =>
      withConfigurationLock(this.configStore.settingsPath, operation)
    );
    this.operationChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private assertSelectionsAvailable(
    settings: AppearanceSettings,
    catalog: AppearanceFontCatalogSnapshot
  ): void {
    const available = new Set(catalog.fonts.map((font) => font.id));
    for (const selection of [
      settings.uiFontFamily,
      settings.editorFontFamily
    ]) {
      if (isAppearanceCustomFontId(selection) && !available.has(selection)) {
        throw new AppearanceFontUnavailableError(selection);
      }
    }
  }

  private async reconcileAppearance(
    snapshot: AppearanceSettingsSnapshot,
    catalog: AppearanceFontCatalogSnapshot
  ): Promise<AppearanceSettingsSnapshot> {
    const available = new Set(catalog.fonts.map((font) => font.id));
    const uiMissing =
      isAppearanceCustomFontId(snapshot.settings.uiFontFamily) &&
      !available.has(snapshot.settings.uiFontFamily);
    const editorMissing =
      isAppearanceCustomFontId(snapshot.settings.editorFontFamily) &&
      !available.has(snapshot.settings.editorFontFamily);
    if (!uiMissing && !editorMissing) return snapshot;

    return this.configStore.save({
      ...snapshot.settings,
      uiFontFamily: uiMissing
        ? DEFAULT_APPEARANCE_UI_FONT_FAMILY
        : snapshot.settings.uiFontFamily,
      editorFontFamily: editorMissing
        ? DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY
        : snapshot.settings.editorFontFamily
    });
  }
}
