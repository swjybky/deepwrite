import {
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  LONG_MATERIAL_KINDS,
  type LongMaterialPackRequest,
  type LongMaterialPreview
} from "@deepwrite/contracts";
import { statusCounts, type LongMaterialPackService } from "./service";

/** What a conversion would write, with statuses against the libraries. */
export async function previewLongMaterial(
  service: LongMaterialPackService,
  request: LongMaterialPackRequest
): Promise<LongMaterialPreview> {
  const record = await service.readRecord(request);
  const { source, plan, reconciled, libraryIds, libraryTitles, states } =
    await service.plan(request, record);
  const byKey = new Map(reconciled.map((entry) => [entry.key, entry]));
  const warnings: string[] = [];
  let capacityOk = true;
  const libraries = LONG_MATERIAL_KINDS.map((kind) => {
    const entries = [
      ...plan.entries
        .filter((entry) => entry.kind === kind)
        .flatMap((entry) => byKey.get(entry.key)?.view ?? []),
      ...reconciled
        .filter((entry) => entry.status === "stale" && entry.view.kind === kind)
        .map(({ view }) => view)
    ];
    const existing = states.get(libraryIds[kind])?.manifest.entries.length ?? 0;
    const added = entries.filter(({ status }) => status === "new").length;
    if (existing + added > CATALOG_PROJECT_MAX_CONTENT_ITEMS) {
      capacityOk = false;
      warnings.push(
        `${libraryTitles[kind]}容量不足，请减少转换内容或换用新分组。`
      );
    }
    return {
      kind,
      title: libraryTitles[kind],
      ...(record ? { libraryId: libraryIds[kind] } : {}),
      characters: entries.reduce(
        (total, { characters }) => total + characters,
        0
      ),
      entries
    };
  });
  const counts = statusCounts(reconciled);
  if (source.decomposition && !source.decomposition.completed)
    warnings.push("这本书的整书拆解尚未完成，转换出的素材可能不完整。");
  if (plan.entries.length <= 1) warnings.push("这本长篇还没有可转换的内容。");
  if (
    request.options.sections.includes("style") &&
    !source.decomposition?.style &&
    !record?.guide?.submission.style
  )
    warnings.push("没有文风画像的来源，可开启仿写增强生成。");
  if (counts.conflict)
    warnings.push(
      `有 ${counts.conflict} 条素材被你改过，转换时默认保留你的修改。`
    );
  const snapshot = record ? await service.summaries(request.bookId) : [];
  return {
    bookId: request.bookId,
    groupTitle:
      request.target.action === "create"
        ? request.target.title
        : (snapshot.find(({ id }) => id === record?.id)?.groupTitle ??
          `《${source.title}》仿写素材`),
    libraries,
    totalEntries: plan.entries.length,
    totalCharacters: libraries.reduce(
      (total, { characters }) => total + characters,
      0
    ),
    splitCount: plan.entries.filter(({ title }) => /（\d+\/\d+）$/u.test(title))
      .length,
    chaptersPerEntry: plan.chaptersPerEntry,
    counts,
    capacityOk,
    warnings: warnings.slice(0, 20)
  };
}
