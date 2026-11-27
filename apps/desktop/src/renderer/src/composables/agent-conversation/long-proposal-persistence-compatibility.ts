import { LongWorkspaceImpactConfirmationSchema } from "@deepwrite/contracts";
import { isRecord } from "@deepwrite/shared";

const LEGACY_IMPACT_SUMMARY_KEYS = [
  "createdEntityIds",
  "updatedEntityIds",
  "deletedEntityIds",
  "createdFileIds",
  "deletedFileIds",
  "documentWriteProposalIds"
] as const;

const RETIRED_NESTED_METADATA_KEYS = new Set([
  "reversible",
  "longUndoBatch",
  "rollbackSnapshot",
  "rollbackSnapshots",
  "rollbackState",
  "undoBatch"
]);

const RETIRED_STRICT_BOUNDARY_KEYS = new Set(["before", "fileChanges"]);

const RETIRED_STATUS_MESSAGE_PATTERN =
  /\brevisions?\b|\bversions?\b|\brollback\b|\breversible\b|stale\s+expected|\bcas\b|版本|回滚/iu;

function isRetiredLongVersionKey(key: string): boolean {
  return (
    key !== "schemaVersion" &&
    (key === "revision" ||
      key.endsWith("Revision") ||
      key.endsWith("Revisions"))
  );
}

function stripRetiredLongProposalMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripRetiredLongProposalMetadata);
  }
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      isRetiredLongVersionKey(key) || RETIRED_NESTED_METADATA_KEYS.has(key)
        ? []
        : [[key, stripRetiredLongProposalMetadata(item)]]
    )
  );
}

function withoutRetiredStrictBoundaryFields(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !RETIRED_STRICT_BOUNDARY_KEYS.has(key)
    )
  );
}

export function isStoredLongProposalCandidate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.stageId === "long-worldbuilding" &&
      value.longWorldbuildingTarget !== undefined) ||
    (value.stageId === "long-character" &&
      value.longCharacterTarget !== undefined) ||
    (value.stageId === "long-plot-design" &&
      value.longPlotDesignTarget !== undefined) ||
    (value.stageId === "long-draft" && value.longDraftTarget !== undefined)
  );
}

export function normalizeStoredLongProposalStatusMessage(
  value: unknown
): string | undefined {
  if (typeof value !== "string") return undefined;
  return RETIRED_STATUS_MESSAGE_PATTERN.test(value) ? undefined : value;
}

function withoutLegacyExpectedImpact(value: unknown): unknown {
  if (!isRecord(value) || value.expectedImpact === undefined) return value;
  if (
    LongWorkspaceImpactConfirmationSchema.safeParse(value.expectedImpact)
      .success
  ) {
    return value;
  }
  const expectedImpact = value.expectedImpact;
  if (!isRecord(expectedImpact)) return value;
  const impactKeys = Object.keys(expectedImpact);
  if (
    impactKeys.length !== LEGACY_IMPACT_SUMMARY_KEYS.length ||
    !LEGACY_IMPACT_SUMMARY_KEYS.every((key) => {
      const ids = expectedImpact[key];
      return Array.isArray(ids) && ids.every((id) => typeof id === "string");
    })
  ) {
    return value;
  }
  const { expectedImpact: _retiredExpectedImpact, ...rest } = value;
  return rest;
}

/**
 * Retired long-form version, rollback, and undo fields may still exist in
 * renderer conversation persistence. Remove only that legacy metadata at the
 * target, batch, and file boundaries before current strict schemas validate it.
 * Old impact summaries are discarded so acceptance previews fresh impact.
 */
export function normalizeStoredLongProposalTarget(value: unknown): unknown {
  const normalized = stripRetiredLongProposalMetadata(value);
  if (!isRecord(normalized)) return normalized;
  const target = withoutLegacyExpectedImpact(
    withoutRetiredStrictBoundaryFields(normalized)
  );
  if (!isRecord(target)) return target;
  return {
    ...target,
    ...(target.batch === undefined
      ? {}
      : {
          batch: withoutLegacyExpectedImpact(
            withoutRetiredStrictBoundaryFields(target.batch)
          )
        }),
    ...(target.file === undefined
      ? {}
      : { file: withoutRetiredStrictBoundaryFields(target.file) }),
    ...(Array.isArray(target.files)
      ? {
          files: target.files.map(withoutRetiredStrictBoundaryFields)
        }
      : {})
  };
}
