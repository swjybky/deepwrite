import { DecompositionReceiptSchema } from "@deepwrite/contracts";
import { ValidatedFileReadCache } from "../validated-file-read-cache";
import { sha256Hex } from "@deepwrite/shared/node";

// These caches survive command-scoped services, while each read checks the
// current file metadata. They never cache recovery outcomes or write authority.
export const decompositionContentReads = new ValidatedFileReadCache(
  32 * 1024 * 1024,
  (content) => ({ content, sha256: sha256Hex(content) })
);
export const decompositionReceiptReads = new ValidatedFileReadCache(
  8 * 1024 * 1024,
  (text) => {
    try {
      const result = DecompositionReceiptSchema.safeParse(JSON.parse(text));
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }
);

/** Keep recovery reads bounded while avoiding a serial filesystem round trip per file. */
export async function mapDecompositionReads<T, R>(
  items: readonly T[],
  read: (item: T) => Promise<R>
): Promise<R[]> {
  const result: R[] = [];
  for (let offset = 0; offset < items.length; offset += 8) {
    result.push(
      ...(await Promise.all(items.slice(offset, offset + 8).map(read)))
    );
  }
  return result;
}
