import { LibraryManagementScopeSchema } from "@deepwrite/contracts/renderer";
import type { AgentEditProposal } from "../../types/conversation";
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
export function parseStoredLibraryTarget(
  value: unknown
): AgentEditProposal["libraryTarget"] | undefined {
  if (
    !isRecord(value) ||
    (value.operation !== "create" &&
      value.operation !== "edit" &&
      value.operation !== "edit-overview") ||
    (value.domain !== "material" && value.domain !== "skill") ||
    typeof value.libraryId !== "string" ||
    (value.libraryTitle !== undefined &&
      typeof value.libraryTitle !== "string") ||
    (value.operation === "edit-overview"
      ? value.stageId !== undefined
      : typeof value.stageId !== "string") ||
    (value.baseProjectRevision !== undefined &&
      !nonnegativeInteger(value.baseProjectRevision)) ||
    (value.entryId !== undefined && typeof value.entryId !== "string") ||
    (value.operation === "edit" && typeof value.entryId !== "string")
  ) {
    return undefined;
  }
  const scope =
    value.managementScope === undefined
      ? undefined
      : LibraryManagementScopeSchema.safeParse(value.managementScope);
  if (scope && !scope.success) return undefined;
  return {
    ...(scope?.success ? { managementScope: scope.data } : {}),
    operation: value.operation,
    domain: value.domain,
    libraryId: value.libraryId,
    ...(typeof value.libraryTitle === "string"
      ? { libraryTitle: value.libraryTitle }
      : {}),
    ...(value.operation === "edit-overview"
      ? {}
      : { stageId: value.stageId as string }),
    ...(value.baseProjectRevision === undefined
      ? {}
      : { baseProjectRevision: value.baseProjectRevision }),
    ...(value.entryId === undefined ? {} : { entryId: value.entryId })
  };
}
