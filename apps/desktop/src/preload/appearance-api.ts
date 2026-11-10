import {
  AppearanceCustomFontIdSchema,
  AppearanceFontCatalogSnapshotSchema,
  AppearanceFontInstallResultSchema,
  AppearanceFontRemoveResultSchema,
  AppearanceSettingsSchema,
  AppearanceSaveCommandEnvelopeSchema,
  AppearanceSettingsSnapshotSchema,
  createEnvelope,
  type AppearanceCustomFontId,
  type AppearanceFontCatalogSnapshot,
  type AppearanceFontInstallResult,
  type AppearanceFontRemoveResult,
  type AppearanceSettings,
  type AppearanceSettingsSnapshot,
  type DeepWriteApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export async function listAppearance(): Promise<AppearanceSettingsSnapshot> {
  const id = browserId("cmd_appearance_list");
  return AppearanceSettingsSnapshotSchema.parse(
    await invokeCommand<AppearanceSettingsSnapshot>(
      createEnvelope("appearance.list", {}, { id, correlationId: id })
    )
  );
}

export async function saveAppearance(
  rawSettings: AppearanceSettings,
  options?: { captureCurrentWindowSize?: boolean }
): Promise<AppearanceSettingsSnapshot> {
  const settings = AppearanceSettingsSchema.parse(rawSettings);
  const id = browserId("cmd_appearance_save");
  return AppearanceSettingsSnapshotSchema.parse(
    await invokeCommand<AppearanceSettingsSnapshot>(
      AppearanceSaveCommandEnvelopeSchema.parse(
        createEnvelope(
          "appearance.save",
          {
            ...settings,
            captureCurrentWindowSize: options?.captureCurrentWindowSize
          },
          { id, correlationId: id }
        )
      )
    )
  );
}

export async function listAppearanceFonts(): Promise<AppearanceFontCatalogSnapshot> {
  const id = browserId("cmd_appearance_fonts_list");
  return AppearanceFontCatalogSnapshotSchema.parse(
    await invokeCommand<AppearanceFontCatalogSnapshot>(
      createEnvelope("appearance.fonts.list", {}, { id, correlationId: id })
    )
  );
}

export async function installAppearanceFonts(): Promise<AppearanceFontInstallResult> {
  const id = browserId("cmd_appearance_fonts_install");
  return AppearanceFontInstallResultSchema.parse(
    await invokeCommand<AppearanceFontInstallResult>(
      createEnvelope("appearance.fonts.install", {}, { id, correlationId: id })
    )
  );
}

export async function removeAppearanceFont(
  rawId: AppearanceCustomFontId
): Promise<AppearanceFontRemoveResult> {
  const fontId = AppearanceCustomFontIdSchema.parse(rawId);
  const id = browserId("cmd_appearance_fonts_remove");
  return AppearanceFontRemoveResultSchema.parse(
    await invokeCommand<AppearanceFontRemoveResult>(
      createEnvelope(
        "appearance.fonts.remove",
        { id: fontId },
        { id, correlationId: id }
      )
    )
  );
}

export const appearance: DeepWriteApi["appearance"] = {
  list: listAppearance,
  save: saveAppearance,
  fonts: {
    list: listAppearanceFonts,
    install: installAppearanceFonts,
    remove: removeAppearanceFont
  }
};
