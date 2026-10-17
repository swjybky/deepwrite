import { z } from "zod";
import { DECOMPOSITION_MAX_CHAPTERS, DecompositionIdSchema } from "./limits";

export const DecompositionCharacterTierSchema = z.enum([
  "protagonist",
  "major_supporting",
  "minor_supporting",
  "passerby"
]);
export const DecompositionRegistryDataSchema = z.object({
  characters: z
    .array(
      z.object({
        id: DecompositionIdSchema,
        name: z.string().trim().min(1).max(256),
        aliases: z.array(z.string().trim().min(1).max(256)).max(100),
        tier: DecompositionCharacterTierSchema,
        firstChapterOrder: z
          .number()
          .int()
          .min(1)
          .max(DECOMPOSITION_MAX_CHAPTERS),
        chunkCount: z.number().int().nonnegative(),
        ignored: z.boolean().optional()
      })
    )
    .max(5000),
  terms: z
    .array(
      z.object({
        id: DecompositionIdSchema,
        categoryId: DecompositionIdSchema,
        name: z.string().trim().min(1).max(256),
        aliases: z.array(z.string().trim().min(1).max(256)).max(100),
        mentionCount: z.number().int().nonnegative(),
        ignored: z.boolean().optional()
      })
    )
    .max(10_000)
});
/**
 * A registrar's decisions, not the registry itself: entries are named by the
 * numbers the evidence pack gives them, and Core builds the registry from
 * the names, counts and chapters it already holds. Output grows with the
 * decisions taken, never with the names reviewed.
 */
export const DecompositionRegistryPlanSchema = z.object({
  /** Numbers of one object; a single number only sets its tier or category. */
  groups: z
    .array(
      z.object({
        refs: z.array(DecompositionIdSchema).min(1).max(200),
        name: z.string().trim().min(1).max(256).optional(),
        tier: DecompositionCharacterTierSchema.optional(),
        categoryId: DecompositionIdSchema.optional()
      })
    )
    .max(5000),
  /** Numbers of names that are no object at all. */
  ignored: z.array(DecompositionIdSchema).max(20_000)
});
export type DecompositionRegistryPlan = z.infer<
  typeof DecompositionRegistryPlanSchema
>;
export const DecompositionRegistrySchema =
  DecompositionRegistryDataSchema.extend({
    version: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    editedByUser: z.boolean(),
    nameIndex: z.record(z.string(), z.string())
  });
export type DecompositionRegistryData = z.infer<
  typeof DecompositionRegistryDataSchema
>;
export type DecompositionRegistry = z.infer<typeof DecompositionRegistrySchema>;

export function normalizeDecompositionRegistry(
  data: DecompositionRegistryData,
  version: number,
  editedByUser = false
): DecompositionRegistry {
  const parsed = DecompositionRegistryDataSchema.parse(data);
  const ids = new Set<string>();
  const nameIndex: Record<string, string> = {};
  for (const item of [...parsed.characters, ...parsed.terms]) {
    if (ids.has(item.id)) throw new Error("名册标识不能重复。");
    ids.add(item.id);
    if (item.ignored) continue;
    for (const name of [item.name, ...item.aliases]) {
      const key = ("tier" in item ? "character:" : "world:") + name;
      if (nameIndex[key] && nameIndex[key] !== item.id)
        throw new Error(`名册别名重复：${name}`);
      nameIndex[key] = item.id;
    }
  }
  return DecompositionRegistrySchema.parse({
    ...parsed,
    nameIndex,
    version,
    editedByUser,
    updatedAt: new Date().toISOString()
  });
}
