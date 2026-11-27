import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FAVORITE_MODELS_STORAGE_KEY,
  resetFavoriteModelsForTest,
  useFavoriteModels
} from "./favoriteModels";

function createMemoryStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    }
  } as Storage;
}

describe("favoriteModels", () => {
  afterEach(() => {
    resetFavoriteModelsForTest();
    vi.unstubAllGlobals();
  });

  it("toggles favorite models, deduplicates, and persists to uiStorage", () => {
    const storage = createMemoryStorage({
      [FAVORITE_MODELS_STORAGE_KEY]: JSON.stringify([
        "model-a",
        "model-a",
        " ",
        42,
        "model-b"
      ])
    });
    vi.stubGlobal("window", { localStorage: storage });

    const { favoriteIds, isFavorite, toggleFavorite } = useFavoriteModels();
    expect(favoriteIds.value).toEqual(["model-a", "model-b"]);
    expect(isFavorite("model-a")).toBe(true);
    expect(isFavorite("model-c")).toBe(false);

    toggleFavorite("model-c");
    expect(favoriteIds.value).toEqual(["model-c", "model-a", "model-b"]);
    expect(
      JSON.parse(storage.getItem(FAVORITE_MODELS_STORAGE_KEY) ?? "[]")
    ).toEqual(["model-c", "model-a", "model-b"]);

    toggleFavorite("model-a");
    expect(favoriteIds.value).toEqual(["model-c", "model-b"]);
    expect(isFavorite("model-a")).toBe(false);
  });

  it("recovers safely from corrupted storage and caps at 200 entries", () => {
    const storage = createMemoryStorage({
      [FAVORITE_MODELS_STORAGE_KEY]: "{not-valid-json"
    });
    vi.stubGlobal("window", { localStorage: storage });

    const { favoriteIds, toggleFavorite } = useFavoriteModels();
    expect(favoriteIds.value).toEqual([]);

    for (let i = 0; i < 210; i++) {
      toggleFavorite(`model-${i}`);
    }
    expect(favoriteIds.value).toHaveLength(200);
    expect(favoriteIds.value[0]).toBe("model-209");

    toggleFavorite("   ");
    expect(favoriteIds.value).toHaveLength(200);
  });
});
