import type { LinkedMaterialIdsByKind } from "@deepwrite/contracts/renderer";

/** Writing runs hydrate skills locally; Main supplies a Core material catalog. */
export function withoutMaterialBodies<T extends { domain: string }>(
  documents: readonly T[]
): T[] {
  return documents.filter((document) => document.domain !== "material");
}

export function withoutMaterialBindings<
  T extends { linkedMaterialIdsByKind: LinkedMaterialIdsByKind }
>(book: T): T {
  return {
    ...book,
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    }
  };
}
