import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

const Id = z.string().trim().min(1).max(512);
const Ids = z
  .array(Id)
  .max(4096)
  .refine((ids) => new Set(ids).size === ids.length);
export const LibraryOrganizationSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    material: Ids,
    skill: Ids,
    groups: z.record(Id, Ids),
    unboundLibraryIds: Ids,
    entryLocations: z
      .record(
        z.string().max(2048),
        z.object({ libraryId: Id, entryId: Id }).strict()
      )
      .optional()
  })
  .strict();
export type LibraryOrganization = z.infer<typeof LibraryOrganizationSchema>;
export function emptyLibraryOrganization(): LibraryOrganization {
  return {
    revision: 0,
    material: [],
    skill: [],
    groups: {},
    unboundLibraryIds: []
  };
}
export const ReorderLibraryInputSchema = z
  .object({
    domain: z.enum(["material", "skill"]),
    groupId: Id.optional(),
    id: Id,
    anchorId: Id,
    position: z.enum(["before", "after"]),
    baseRevision: z.number().int().nonnegative()
  })
  .strict()
  .refine(
    (input) => input.id !== input.anchorId,
    "Cannot reorder relative to itself."
  );
export type ReorderLibraryInput = z.infer<typeof ReorderLibraryInputSchema>;
export const CatalogReorderLibraryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.reorderLibrary"),
    payload: ReorderLibraryInputSchema
  });

/** Preserve known order, remove stale ids, append new items in their default order. */
export function reconcileLibraryOrder(
  ids: readonly string[],
  order: readonly string[]
): string[] {
  const available = new Set(ids);
  return [...new Set([...order.filter((id) => available.has(id)), ...ids])];
}
export function reorderLibraryIds(
  ids: readonly string[],
  input: Pick<ReorderLibraryInput, "id" | "anchorId" | "position">
): string[] {
  if (
    input.id === input.anchorId ||
    !ids.includes(input.id) ||
    !ids.includes(input.anchorId)
  )
    throw new Error("排序目标不存在或不在同一层级。");
  const next = ids.filter((id) => id !== input.id);
  next.splice(
    next.indexOf(input.anchorId) + (input.position === "after" ? 1 : 0),
    0,
    input.id
  );
  return next;
}

export const CreateUnboundEntryInputSchema = z
  .object({
    domain: z.enum(["material", "skill"]),
    title: z.string().trim().min(1).max(256),
    content: z.string().max(40000),
    /** Legacy metadata, retained for older clients; libraries are shared. */
    libraryType: z.enum(["short", "script", "long"]).optional(),
    stageId: z.string().min(1).max(120),
    skillKind: z.enum(["general", "plot", "style", "other"]).optional()
  })
  .strict();
export type CreateUnboundEntryInput = z.infer<
  typeof CreateUnboundEntryInputSchema
>;
export type UnboundEntryDraft = Omit<CreateUnboundEntryInput, "content"> & {
  unbound: true;
};
export const CreateUnboundEntryResultSchema = z
  .object({ libraryId: Id, entryId: Id })
  .strict();
export type CreateUnboundEntryResult = z.infer<
  typeof CreateUnboundEntryResultSchema
>;
export const CatalogCreateUnboundEntryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createUnboundEntry"),
    payload: CreateUnboundEntryInputSchema
  });

export function resolveLibraryEntryLocation(
  organization: LibraryOrganization | undefined,
  libraryId: string,
  entryId: string
) {
  const seen = new Set<string>();
  let location = { libraryId, entryId };
  for (;;) {
    const key = JSON.stringify([location.libraryId, location.entryId]);
    if (seen.has(key)) throw new Error("条目引用存在循环。");
    seen.add(key);
    const next = organization?.entryLocations?.[key];
    if (!next) return location;
    location = next;
  }
}
