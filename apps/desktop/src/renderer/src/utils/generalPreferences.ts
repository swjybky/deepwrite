export const GENERAL_PREFERENCES_STORAGE_KEY = "deepwrite:general-preferences:v1";

export interface GeneralPreferences {
  autoSave: boolean;
}

export const DEFAULT_GENERAL_PREFERENCES: GeneralPreferences = {
  autoSave: false
};

interface GeneralPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function parseGeneralPreferences(storedValue: string | null): GeneralPreferences {
  if (!storedValue) return { ...DEFAULT_GENERAL_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_GENERAL_PREFERENCES };
    }
    const candidate = parsed as Record<string, unknown>;
    return {
      autoSave:
        candidate.version === 1 && typeof candidate.autoSave === "boolean"
          ? candidate.autoSave
          : DEFAULT_GENERAL_PREFERENCES.autoSave
    };
  } catch {
    return { ...DEFAULT_GENERAL_PREFERENCES };
  }
}

export function loadGeneralPreferences(
  storage: Pick<GeneralPreferencesStorage, "getItem">
): GeneralPreferences {
  try {
    return parseGeneralPreferences(storage.getItem(GENERAL_PREFERENCES_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_GENERAL_PREFERENCES };
  }
}

export function saveGeneralPreferences(
  storage: Pick<GeneralPreferencesStorage, "setItem">,
  preferences: GeneralPreferences
): boolean {
  try {
    storage.setItem(
      GENERAL_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 1, autoSave: preferences.autoSave })
    );
    return true;
  } catch {
    return false;
  }
}
