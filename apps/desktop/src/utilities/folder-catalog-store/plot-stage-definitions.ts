import {
  createDefaultCreativePlotStages,
  CreativePlotStagesSchema,
  type CreativePlotStage
} from "@deepwrite/contracts";

export function mergeCreativePlotStageDefinitions(
  ...groups: ReadonlyArray<
    ReadonlyArray<{ id: string; title: string; description: string }>
  >
): CreativePlotStage[] {
  const definitions = new Map<string, CreativePlotStage>();
  for (const group of groups) {
    for (const stage of group) {
      if (!definitions.has(stage.id)) {
        definitions.set(stage.id, {
          id: stage.id,
          title: stage.title,
          description: stage.description
        });
      }
    }
  }
  for (const stage of createDefaultCreativePlotStages()) {
    if (!definitions.has(stage.id)) definitions.set(stage.id, stage);
  }
  const stages = [...definitions.values()];
  const reservedTitles = new Set(
    stages.map(({ title }) => title.trim().toLocaleLowerCase())
  );
  const usedTitles = new Set<string>();
  for (const stage of stages) {
    const title = stage.title.trim();
    let candidate = title;
    let suffix = 2;
    if (usedTitles.has(candidate.toLocaleLowerCase())) {
      do {
        const ending = `（${suffix++}）`;
        candidate = `${title.slice(0, 120 - ending.length).trimEnd()}${ending}`;
      } while (
        usedTitles.has(candidate.toLocaleLowerCase()) ||
        reservedTitles.has(candidate.toLocaleLowerCase())
      );
    }
    // Never alter an identity: documents and enabled flags refer to stage IDs.
    stage.title = candidate;
    usedTitles.add(candidate.toLocaleLowerCase());
  }
  return CreativePlotStagesSchema.parse(stages);
}

export function sameCreativePlotStageDefinitions(
  left: readonly CreativePlotStage[],
  right: readonly CreativePlotStage[]
): boolean {
  if (left.length !== right.length) return false;
  const rightById = new Map(right.map((stage) => [stage.id, stage]));
  return left.every((stage) => {
    const other = rightById.get(stage.id);
    return (
      other !== undefined &&
      other.title === stage.title &&
      other.description === stage.description
    );
  });
}
