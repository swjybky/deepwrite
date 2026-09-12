import type { buildSettingsFeatureModule } from "../composables/settingsFeatureModule";

/** Keep the workspace visible until both layers of the settings page are ready. */
export async function loadSettingsFeature(): Promise<
  typeof buildSettingsFeatureModule
> {
  const [settings] = await Promise.all([
    import("../composables/settingsFeatureModule"),
    import("./WorkspaceFeatureModules.vue"),
    import("./SettingsPage.vue")
  ]);
  return settings.buildSettingsFeatureModule;
}
