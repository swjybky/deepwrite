import { computed, ref } from "vue";
import { optionalUiStorage } from "./uiStorage";

export const FAVORITE_MODELS_STORAGE_KEY = "deepwrite:favorite-model-ids:v1";
const MAX_FAVORITE_MODELS = 200;

let hydrated = false;
const favoriteIdsState = ref<string[]>([]);

function normalizeFavoriteIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
    if (normalized.length >= MAX_FAVORITE_MODELS) break;
  }
  return normalized;
}

function loadFavoriteIds(): string[] {
  const storage = optionalUiStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(FAVORITE_MODELS_STORAGE_KEY);
    if (!raw) return [];
    return normalizeFavoriteIds(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

function saveFavoriteIds(ids: readonly string[]): void {
  const storage = optionalUiStorage();
  if (!storage) return;
  try {
    storage.setItem(FAVORITE_MODELS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Ignore storage quota or private browsing write failures.
  }
}

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  favoriteIdsState.value = loadFavoriteIds();
}

/** Shared favorite-model IDs persisted in UI storage. */
export function useFavoriteModels() {
  ensureHydrated();
  const favoriteIds = computed<readonly string[]>(() => favoriteIdsState.value);
  const favoriteSet = computed(() => new Set(favoriteIdsState.value));

  function isFavorite(modelId: string): boolean {
    ensureHydrated();
    return Boolean(modelId) && favoriteSet.value.has(modelId);
  }

  function toggleFavorite(modelId: string): void {
    ensureHydrated();
    const trimmed = modelId.trim();
    if (!trimmed) return;
    const current = favoriteIdsState.value;
    const next = current.includes(trimmed)
      ? current.filter((id) => id !== trimmed)
      : [trimmed, ...current].slice(0, MAX_FAVORITE_MODELS);
    favoriteIdsState.value = next;
    saveFavoriteIds(next);
  }

  return {
    favoriteIds,
    isFavorite,
    toggleFavorite
  };
}

export function resetFavoriteModelsForTest(): void {
  hydrated = false;
  favoriteIdsState.value = [];
}
