import type {
  CatalogSnapshot,
  LongBookSummary,
  LongBookDecompositionJob
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator, locale } from "../../i18n";

const t = createScopedTranslator("extras.longBookDecomposition");
/** Name the actual destination so two runs of the same source remain distinguishable. */
export function decompositionJobOption(
  job: LongBookDecompositionJob,
  books: readonly LongBookSummary[],
  catalog: CatalogSnapshot | null
) {
  const target = job.target;
  const title =
    (target?.kind === "long"
      ? books.find(({ id }) => id === target.bookId)?.title
      : catalog?.materialGroups.find(({ id }) => id === target?.groupId)
          ?.title) ??
    (job.targetSelection.action === "create"
      ? job.targetSelection.title
      : job.source.title);
  const date = new Date(job.createdAt).toLocaleString(locale.value, {
    dateStyle: "short",
    timeStyle: "short"
  });
  const phaseText =
    job.phase === "registry" ? t("registryPhase") : t(job.phase);
  const statusSuffix =
    job.status === "failed"
      ? ` · ${t("failed")}`
      : job.status === "ended"
        ? ` · ${t("endedStatus")}`
        : "";
  return {
    value: job.id,
    label: `${title} · ${date} · ${job.mode === "continuation" ? t("continuation") : t("materials")}`,
    description: `${job.source.title} · ${phaseText}${statusSuffix}`
  };
}
