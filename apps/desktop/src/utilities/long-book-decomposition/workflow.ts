import {
  decompositionReadingUnitId,
  splitDecompositionChronicles,
  normalizeDecompositionRegistry,
  readyDecompositionUnitIds,
  type LongBookDecompositionJob,
  type DecompositionRegistry,
  type DecompositionReadingCard,
  type DecompositionUnit
} from "@deepwrite/contracts";
import { decompositionSha } from "./content-guard";
import { planCharacterBiographies } from "./character-biographies";
import {
  addRegistryParts,
  registryMentionItems,
  replanLegacyRegistryParts
} from "./registry-mentions";

export function addDecompositionUnit(
  job: LongBookDecompositionJob,
  id: string,
  phase: DecompositionUnit["phase"],
  dependencies: string[] = []
): void {
  const prior = job.units[id];
  if (prior) {
    if (JSON.stringify(prior.dependencies) !== JSON.stringify(dependencies)) {
      prior.dependencies = dependencies;
      prior.inputRevision = decompositionSha(
        JSON.stringify({
          previous: prior.inputRevision,
          dependencies
        })
      );
      prior.status = "pending";
      prior.attempts = 0;
      prior.outputRefs = [];
      prior.receiptIds = [];
      delete prior.requiredReceiptIds;
    }
    if (phase === "integrate" && prior.status === "skipped") {
      prior.status = "pending";
      prior.inputRevision = decompositionSha(`${prior.inputRevision}:restored`);
    }
    return;
  }
  job.units[id] ??= {
    phase,
    status: "pending",
    attempts: 0,
    inputRevision: decompositionSha(
      JSON.stringify({
        source: job.source.fingerprint,
        output: job.outputVersion,
        id,
        profile: job.profile,
        dependencies
      })
    ),
    dependencies,
    outputRefs: [],
    receiptIds: [],
    updatedAt: new Date().toISOString()
  };
}
export function initializeDecompositionReading(job: LongBookDecompositionJob) {
  for (const chunk of job.chunks) {
    const checkpoints = chunk.chapterIds.map((id) =>
      decompositionReadingUnitId(chunk, id)
    );
    checkpoints.forEach((id) => addDecompositionUnit(job, id, "read"));
    addDecompositionUnit(job, chunk.id, "read", checkpoints);
  }
}
/**
 * One part per call the integration model can decide: the part size follows
 * its output and evidence budgets, never a fixed count of names.
 */
export function planDecompositionRegistry(
  job: LongBookDecompositionJob,
  cards: DecompositionReadingCard[]
) {
  const parts = addRegistryParts(job, registryMentionItems(cards), 1, (id) =>
    addDecompositionUnit(job, id, "registry")
  );
  addDecompositionUnit(job, "registry:merge", "registry", parts);
  job.phase = "registry";
}
/** Re-plans fixed-size registry parts of a job started before budgets. */
export function replanDecompositionRegistry(
  job: LongBookDecompositionJob,
  cards: DecompositionReadingCard[]
): boolean {
  return replanLegacyRegistryParts(job, cards, (id, dependencies) =>
    addDecompositionUnit(job, id, "registry", dependencies)
  );
}
export function validateDecompositionRegistryCoverage(
  registry: DecompositionRegistry,
  cards: DecompositionReadingCard[]
) {
  const names = {
    character: new Set(
      registry.characters.flatMap((entry) => [entry.name, ...entry.aliases])
    ),
    term: new Set(
      registry.terms.flatMap((entry) => [entry.name, ...entry.aliases])
    )
  };
  const missing = registryMentionItems(cards).filter(
    ({ domain, name }) => !names[domain].has(name)
  );
  if (missing.length)
    throw new Error(
      `名册仍有未归属的名字：${missing
        .slice(0, 8)
        .map(({ name }) => name)
        .join(
          "、"
        )}${missing.length > 8 ? ` 等 ${missing.length} 个` : ""}，请补齐或标记忽略。`
    );
}
export function planDecompositionIntegration(
  job: LongBookDecompositionJob,
  registry: DecompositionRegistry,
  cards: DecompositionReadingCard[] = []
) {
  job.chronicleSegments = splitDecompositionChronicles(
    job.chunks,
    job.models.integration
  );
  const chronicles = job.chronicleSegments.map(({ id }) => id);
  chronicles.forEach((id) => addDecompositionUnit(job, id, "integrate"));
  addDecompositionUnit(job, "plot:book-line", "integrate", chronicles);
  addDecompositionUnit(job, "plot:foreshadowing", "integrate", chronicles);
  if (job.mode === "materials")
    addDecompositionUnit(
      job,
      "plot:opening",
      "integrate",
      chronicles.slice(0, 2)
    );
  const protagonists: string[] = [];
  const biographies = planCharacterBiographies(job, registry, cards);
  const validCharacters = new Set(
    registry.characters
      .filter(({ ignored, tier }) => !ignored && tier !== "passerby")
      .map(({ id }) => id)
  );
  const validCategories = new Set(
    registry.terms
      .filter(({ ignored }) => !ignored)
      .map(({ categoryId }) => categoryId)
  );
  for (const [id, unit] of Object.entries(job.units)) {
    if (
      (id.startsWith("character:") && !validCharacters.has(id.slice(10))) ||
      (unit.biography &&
        !biographies
          .get(unit.biography.registryId)
          ?.some((biography) => biography.id === id)) ||
      (id.startsWith("world:") && !validCategories.has(id.slice(6)))
    )
      unit.status = "skipped";
  }
  for (const character of registry.characters.filter(
    ({ ignored, tier }) => !ignored && tier !== "passerby"
  )) {
    const id = `character:${character.id}`;
    const volumes = biographies.get(character.id) ?? [];
    for (const { id: volumeId, ...biography } of volumes) {
      addDecompositionUnit(job, volumeId, "integrate");
      job.units[volumeId]!.biography = biography;
    }
    addDecompositionUnit(
      job,
      id,
      "integrate",
      volumes.map(({ id }) => id)
    );
    if (character.tier !== "minor_supporting") protagonists.push(id);
  }
  for (const category of new Set(
    registry.terms
      .filter(({ ignored }) => !ignored)
      .map(({ categoryId }) => categoryId)
  ))
    addDecompositionUnit(job, `world:${category}`, "integrate");
  addDecompositionUnit(job, "style:profile", "integrate");
  if (job.mode === "continuation")
    addDecompositionUnit(job, "continuity:latest", "integrate", [
      ...protagonists,
      "plot:foreshadowing"
    ]);
  job.phase = "integrate";
}
export function planDecompositionReview(job: LongBookDecompositionJob) {
  for (const domain of [
    "character",
    "world",
    "plot",
    "style",
    ...(job.mode === "continuation" ? ["continuity"] : [])
  ])
    addDecompositionUnit(job, `review:${domain}`, "review");
  job.phase = "review";
}
export function readyDecompositionUnits(
  job: LongBookDecompositionJob
): string[] {
  return readyDecompositionUnitIds(job);
}
export const emptyDecompositionRegistry = () =>
  normalizeDecompositionRegistry({ characters: [], terms: [] }, 1);
