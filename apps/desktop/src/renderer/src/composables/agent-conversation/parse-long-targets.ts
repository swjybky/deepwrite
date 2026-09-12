import type { LongCharacterFileChange } from "@deepwrite/contracts";
import {
  LongCharacterFileChangeSchema,
  LongChapterBodyChangeSchema,
  LongWorkspaceImpactConfirmationSchema,
  LongWorldbuildingFileChangeSchema,
  LongWorkspaceOperationBatchSchema
} from "@deepwrite/contracts/renderer";
import type { AgentEditProposal } from "../../types/conversation";
import { isRecord } from "./shared";
import { normalizeStoredLongProposalTarget } from "./long-proposal-persistence-compatibility";
export function parseStoredLongWorldbuildingTarget(
  value: unknown
): AgentEditProposal["longWorldbuildingTarget"] | undefined {
  value = normalizeStoredLongProposalTarget(value);
  if (
    !isRecord(value) ||
    typeof value.bookId !== "string" ||
    !value.bookId.trim()
  ) {
    return undefined;
  }
  const batch = LongWorkspaceOperationBatchSchema.safeParse(value.batch);
  const file = LongWorldbuildingFileChangeSchema.safeParse(value.file);
  const expectedImpact =
    value.expectedImpact === undefined
      ? undefined
      : LongWorkspaceImpactConfirmationSchema.safeParse(value.expectedImpact);
  if (
    !batch.success ||
    !file.success ||
    (expectedImpact !== undefined && !expectedImpact.success)
  )
    return undefined;
  return {
    bookId: value.bookId,
    batch: batch.data,
    file: file.data,
    ...(expectedImpact?.success ? { expectedImpact: expectedImpact.data } : {})
  };
}
export function parseStoredLongCharacterTarget(
  value: unknown
): AgentEditProposal["longCharacterTarget"] | undefined {
  value = normalizeStoredLongProposalTarget(value);
  if (
    !isRecord(value) ||
    typeof value.bookId !== "string" ||
    !value.bookId.trim() ||
    !Array.isArray(value.files) ||
    value.files.length < 1
  ) {
    return undefined;
  }
  const batch = LongWorkspaceOperationBatchSchema.safeParse(value.batch);
  const expectedImpact =
    value.expectedImpact === undefined
      ? undefined
      : LongWorkspaceImpactConfirmationSchema.safeParse(value.expectedImpact);
  if (
    !batch.success ||
    (expectedImpact !== undefined && !expectedImpact.success)
  )
    return undefined;
  const files: LongCharacterFileChange[] = [];
  for (const file of value.files) {
    const parsed = LongCharacterFileChangeSchema.safeParse(file);
    if (!parsed.success) return undefined;
    files.push(parsed.data);
  }
  return {
    bookId: value.bookId,
    batch: batch.data,
    files,
    ...(expectedImpact?.success ? { expectedImpact: expectedImpact.data } : {})
  };
}
export function parseStoredLongPlotDesignTarget(
  value: unknown
): AgentEditProposal["longPlotDesignTarget"] | undefined {
  value = normalizeStoredLongProposalTarget(value);
  if (
    !isRecord(value) ||
    typeof value.bookId !== "string" ||
    !value.bookId.trim()
  ) {
    return undefined;
  }
  const batch = LongWorkspaceOperationBatchSchema.safeParse(value.batch);
  const expectedImpact =
    value.expectedImpact === undefined
      ? undefined
      : LongWorkspaceImpactConfirmationSchema.safeParse(value.expectedImpact);
  if (
    !batch.success ||
    (expectedImpact !== undefined && !expectedImpact.success)
  )
    return undefined;
  return {
    bookId: value.bookId,
    batch: batch.data,
    ...(expectedImpact?.success ? { expectedImpact: expectedImpact.data } : {})
  };
}
export function parseStoredLongDraftTarget(
  value: unknown
): AgentEditProposal["longDraftTarget"] | undefined {
  value = normalizeStoredLongProposalTarget(value);
  if (
    !isRecord(value) ||
    typeof value.bookId !== "string" ||
    !value.bookId.trim()
  ) {
    return undefined;
  }
  const batch = LongWorkspaceOperationBatchSchema.safeParse(value.batch);
  const file = LongChapterBodyChangeSchema.safeParse(value.file);
  const expectedImpact =
    value.expectedImpact === undefined
      ? undefined
      : LongWorkspaceImpactConfirmationSchema.safeParse(value.expectedImpact);
  if (
    !batch.success ||
    !file.success ||
    (expectedImpact !== undefined && !expectedImpact.success)
  ) {
    return undefined;
  }
  return {
    bookId: value.bookId,
    batch: batch.data,
    file: file.data,
    ...(expectedImpact?.success ? { expectedImpact: expectedImpact.data } : {})
  };
}
