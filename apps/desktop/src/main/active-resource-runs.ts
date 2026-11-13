interface ResourceRun {
  externalResourceIds?: readonly string[];
  resourceId?: string;
}

/** Resource ownership comes from the runs accepted by Main. */
export function activeRunResourceIds(
  runs: Iterable<ResourceRun>
): ReadonlySet<string> {
  return new Set(
    [...runs].flatMap(
      (run) =>
        run.externalResourceIds ?? (run.resourceId ? [run.resourceId] : ["*"])
    )
  );
}

export function hasActiveResourceRun(
  activeRunCount: number,
  activeResourceIds: ReadonlySet<string> | undefined,
  resourceIds?: readonly string[]
): boolean {
  return (
    activeRunCount > 0 &&
    (resourceIds === undefined ||
      !activeResourceIds ||
      activeResourceIds.has("*") ||
      resourceIds.some((id) => activeResourceIds.has(id)))
  );
}
