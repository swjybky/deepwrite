import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DECOMPOSITION_PROFILE,
  LongBookDecompositionJobSchema,
  splitDecompositionChunks,
  type LongBookAnalysisSource,
  type LongBookDecompositionJob,
  type LongBookDecompositionProfile
} from "@deepwrite/contracts";
import { LongBookAnalysisSourceStore } from "../../extras/agents/sources/long-book-source-store";
import { LongWorkspaceService } from "../long-workspace-service";
import { FolderCatalogStore } from "../folder-catalog-store";
import { DecompositionService } from "./service";

export async function decompositionFixture(
  mode: LongBookDecompositionJob["mode"],
  chapterCount = 3,
  chapterText?: (order: number) => string,
  profile: LongBookDecompositionProfile = DEFAULT_DECOMPOSITION_PROFILE
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-decomposition-"))
  );
  const userDataPath = join(root, "user-data");
  const longs = new LongWorkspaceService({ userDataPath });
  const catalog = new FolderCatalogStore({ userDataPath });
  const service = new DecompositionService(root, longs, catalog);
  const sources = new LongBookAnalysisSourceStore(root);
  const source: LongBookAnalysisSource = {
    id: "long_book_analysis_source_fixture",
    kind: "txt",
    name: "合成书籍",
    diagnostics: [],
    chapters: Array.from({ length: chapterCount }, (_, index) => ({
      id: `source_chapter_${index + 1}`,
      order: index + 1,
      title: `第 ${index + 1} 章`,
      volume: `第 ${Math.floor(index / 100) + 1} 卷`,
      sourceName: "合成书籍.txt",
      text:
        chapterText?.(index + 1) ?? `主角在第 ${index + 1} 章继续寻找铜铃。`,
      charCount: (
        chapterText?.(index + 1) ?? `主角在第 ${index + 1} 章继续寻找铜铃。`
      ).length
    }))
  };
  await sources.save(source);
  const saved = await sources.load(source.id);
  const confirmation = await sources.confirm({
    sourceId: saved.id,
    sourceRevision: saved.revision!,
    fingerprint: saved.fingerprint!,
    range: { start: 1, end: chapterCount }
  });
  const model = {
    modelId: "faux",
    thinkingLevel: "off",
    contextWindow: 128_000,
    maxTokens: 8192
  };
  const now = new Date().toISOString();
  const job = LongBookDecompositionJobSchema.parse({
    schemaVersion: 1,
    id: `ldjob_${mode}`,
    createdAt: now,
    updatedAt: now,
    mode,
    source: {
      sourceId: saved.id,
      sourceRevision: saved.revision,
      fingerprint: saved.fingerprint,
      confirmationId: confirmation.id,
      confirmedAt: confirmation.confirmedAt,
      title: saved.name,
      chapterCount,
      characterCount: saved.chapters.reduce(
        (sum, { charCount }) => sum + charCount,
        0
      ),
      range: confirmation.range
    },
    profile,
    models: { reading: model, integration: model },
    chunks: splitDecompositionChunks(saved.chapters, model),
    targetSelection: {
      kind: mode === "continuation" ? "long" : "material-group",
      action: "create",
      title: "合成书籍拆解"
    },
    outputVersion: 1,
    autoContinue: true,
    phase: "prepare_target",
    status: "idle",
    units: {}
  });
  const created = await service.create(job, {
    book: join(root, "books"),
    materials: join(root, "materials"),
    groups: join(root, "groups")
  });
  return {
    root,
    userDataPath,
    longs,
    catalog,
    service,
    sources,
    source: saved,
    job: created
  };
}
