import { CharacterStructureMutationSchema } from "@deepwrite/contracts/renderer";
import type { AgentEditProposal } from "../../types/conversation";
import { isRecord, nonnegativeInteger } from "./shared";
export function parseStoredCharacterStructureTarget(
  value: unknown
): AgentEditProposal["characterStructureTarget"] | undefined {
  if (!isRecord(value)) return undefined;
  const mutation = CharacterStructureMutationSchema.safeParse(value.mutation);
  if (!mutation.success) return undefined;
  if (
    (value.initialContent !== undefined &&
      typeof value.initialContent !== "string") ||
    (value.baseProjectRevision !== undefined &&
      !nonnegativeInteger(value.baseProjectRevision))
  ) {
    return undefined;
  }
  return {
    mutation: mutation.data,
    ...(typeof value.initialContent === "string"
      ? { initialContent: value.initialContent }
      : {}),
    ...(value.baseProjectRevision === undefined
      ? {}
      : { baseProjectRevision: value.baseProjectRevision })
  };
}
export function parseStoredPlotStructureTarget(
  value: unknown
): AgentEditProposal["plotStructureTarget"] | undefined {
  if (!isRecord(value) || !isRecord(value.mutation)) return undefined;
  const mutation = value.mutation;
  const baseProjectRevision = value.baseProjectRevision;
  if (
    baseProjectRevision !== undefined &&
    !nonnegativeInteger(baseProjectRevision)
  ) {
    return undefined;
  }
  if (
    mutation.type === "create" &&
    typeof mutation.title === "string" &&
    typeof mutation.description === "string" &&
    typeof mutation.provisionalStageId === "string" &&
    typeof mutation.content === "string"
  ) {
    return {
      mutation: {
        type: "create",
        title: mutation.title,
        description: mutation.description,
        provisionalStageId: mutation.provisionalStageId,
        content: mutation.content
      },
      ...(typeof baseProjectRevision === "number"
        ? { baseProjectRevision }
        : {})
    };
  }
  if (
    mutation.type === "update" &&
    typeof mutation.stageId === "string" &&
    typeof mutation.previousTitle === "string" &&
    typeof mutation.title === "string" &&
    typeof mutation.description === "string"
  ) {
    return {
      mutation: {
        type: "update",
        stageId: mutation.stageId,
        previousTitle: mutation.previousTitle,
        title: mutation.title,
        description: mutation.description
      },
      ...(typeof baseProjectRevision === "number"
        ? { baseProjectRevision }
        : {})
    };
  }
  return undefined;
}
