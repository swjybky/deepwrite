import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  LongBookAnalysisSourceSchema,
  DecompositionSourceConfirmationSchema,
  type LongBookAnalysisSource,
  type DecompositionSourceConfirmation
} from "@deepwrite/contracts";
import {
  commitProjectTransaction,
  recoverProjectTransaction
} from "../project-transaction";
import { readSecureTextFile, readNoFollowFile } from "../long-project-store/io";
import { ValidatedFileReadCache } from "../validated-file-read-cache";

const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
// Shared across command-scoped stores; large or evicted sources use normal reads.
const sourceRevisions = new ValidatedFileReadCache(
  64 * 1024 * 1024,
  (text) => {
    const source = LongBookAnalysisSourceSchema.parse(JSON.parse(text));
    if (source.fingerprint !== longBookSourceFingerprint(source))
      throw new Error("来源版本或指纹不一致，无法继续拆解。");
    return source;
  },
  4
);
export function longBookSourceFingerprint(
  source: LongBookAnalysisSource
): string {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify(
      source.chapters.map(({ id, order, title, volume, text }) => ({
        id,
        order,
        title,
        volume,
        text
      }))
    )
  );
  return hash.digest("hex");
}
export function versionedLongBookSource(
  source: LongBookAnalysisSource,
  revision: number
): LongBookAnalysisSource {
  const chapters = source.chapters.map((chapter) => ({
    ...chapter,
    charCount: chapter.text.length
  }));
  const parsed = LongBookAnalysisSourceSchema.parse({
    ...source,
    chapters,
    revision
  });
  return { ...parsed, fingerprint: longBookSourceFingerprint(parsed) };
}
export async function loadLongBookSourceRevision(
  root: string,
  sourceId: string,
  revision: number
): Promise<LongBookAnalysisSource> {
  await recoverProjectTransaction(root, MAX_SOURCE_BYTES);
  const source = await sourceRevisions.read(
    root,
    `revisions/${revision}.json`,
    MAX_SOURCE_BYTES,
    "来源版本"
  );
  if (source.id !== sourceId || source.revision !== revision)
    throw new Error("来源版本或指纹不一致，无法继续拆解。");
  return source;
}

export async function inspectLongBookSourceRevision(
  root: string,
  sourceId: string,
  revision: number
) {
  await recoverProjectTransaction(root, MAX_SOURCE_BYTES);
  const identity = await sourceRevisions.inspect(
    root,
    `revisions/${revision}.json`,
    MAX_SOURCE_BYTES,
    "来源版本",
    ({ id, revision, fingerprint }) => ({ id, revision, fingerprint })
  );
  if (identity.id !== sourceId || identity.revision !== revision)
    throw new Error("来源版本或指纹不一致，无法继续拆解。");
  return identity;
}
export async function saveLongBookSourceVersion(
  root: string,
  source: LongBookAnalysisSource,
  expectedSha256: string
) {
  await mkdir(join(root, "revisions"), { recursive: true });
  await commitProjectTransaction({
    projectRoot: root,
    maxFileBytes: MAX_SOURCE_BYTES,
    operations: [
      {
        path: `revisions/${source.revision}.json`,
        content: JSON.stringify(source),
        expectedSha256: null
      },
      { path: "source.json", content: JSON.stringify(source), expectedSha256 },
      {
        path: "metadata.json",
        content: JSON.stringify({
          version: 1,
          summary: {
            id: source.id,
            kind: source.kind,
            name: source.name,
            chapterCount: source.chapters.length,
            characterCount: source.chapters.reduce(
              (sum, chapter) => sum + chapter.text.length,
              0
            ),
            importedAt: new Date().toISOString()
          }
        })
      }
    ]
  });
}
export async function confirmLongBookSource(
  root: string,
  source: LongBookAnalysisSource,
  range: { start: number; end: number }
): Promise<DecompositionSourceConfirmation> {
  if (
    range.start < 1 ||
    range.end > source.chapters.length ||
    range.start > range.end
  )
    throw new Error("确认的章节范围无效。");
  const disk = await readNoFollowFile(
    join(root, "source.json"),
    MAX_SOURCE_BYTES,
    "来源",
    root
  );
  const persisted = LongBookAnalysisSourceSchema.parse(
    JSON.parse(disk.bytes.toString("utf8"))
  );
  if (
    persisted.revision !== source.revision ||
    longBookSourceFingerprint(persisted) !== source.fingerprint
  )
    throw new Error("来源已发生变化，请重新校对确认。");
  const confirmation = DecompositionSourceConfirmationSchema.parse({
    id: `ldconfirm_${randomUUID().replaceAll("-", "")}`,
    sourceId: source.id,
    sourceRevision: source.revision,
    fingerprint: source.fingerprint,
    range,
    confirmedAt: new Date().toISOString()
  });
  await mkdir(join(root, "confirmations"), { recursive: true });
  await commitProjectTransaction({
    projectRoot: root,
    maxFileBytes: MAX_SOURCE_BYTES,
    operations: [
      {
        action: "check",
        path: "source.json",
        expectedSha256: createHash("sha256").update(disk.bytes).digest("hex")
      },
      {
        path: `confirmations/${confirmation.id}.json`,
        content: JSON.stringify(confirmation),
        expectedSha256: null
      }
    ]
  });
  return confirmation;
}
export async function readLongBookSourceConfirmation(
  root: string,
  id: string
): Promise<DecompositionSourceConfirmation> {
  const { bytes } = await readNoFollowFile(
    join(root, "confirmations", `${id}.json`),
    64 * 1024,
    "来源确认回执",
    root
  );
  return DecompositionSourceConfirmationSchema.parse(
    JSON.parse(bytes.toString("utf8"))
  );
}

export { readSecureTextFile };
