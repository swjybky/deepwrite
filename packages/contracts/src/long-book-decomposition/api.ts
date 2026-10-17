import { z } from "zod";
import type {
  CreateDecompositionJobInput,
  DecompositionControlInput
} from "./commands";
import { DecompositionRegistrySchema } from "./registry";
import type { DecompositionRegistryData } from "./registry";
import { LongBookDecompositionJobSchema } from "./job";
import { DecompositionContentRefSchema } from "./target";
import { DECOMPOSITION_MAX_CHAPTERS } from "./limits";
import { DecompositionRecordSchema } from "./records";
export const DecompositionResultsSchema = z.array(
  z.object({
    unitId: z.string(),
    status: z.string(),
    refs: z.array(DecompositionContentRefSchema),
    title: z.string()
  })
);
/** One unit's task-local record(s); a reading chunk returns its chapters. */
export const DecompositionUnitViewSchema = z.object({
  unitId: z.string(),
  records: z.array(DecompositionRecordSchema).max(100),
  refs: z.array(DecompositionContentRefSchema)
});
export type DecompositionUnitView = z.infer<typeof DecompositionUnitViewSchema>;
export const DecompositionJobsSchema = z
  .array(LongBookDecompositionJobSchema)
  .max(DECOMPOSITION_MAX_CHAPTERS);
export type DecompositionResults = z.infer<typeof DecompositionResultsSchema>;
export interface LongBookDecompositionApi {
  createJob(
    input: CreateDecompositionJobInput
  ): Promise<z.infer<typeof LongBookDecompositionJobSchema>>;
  listJobs(): Promise<z.infer<typeof DecompositionJobsSchema>>;
  getJob(
    jobId: string
  ): Promise<z.infer<typeof LongBookDecompositionJobSchema>>;
  control(
    input: DecompositionControlInput
  ): Promise<z.infer<typeof LongBookDecompositionJobSchema> | null>;
  getRegistry(
    jobId: string
  ): Promise<z.infer<typeof DecompositionRegistrySchema>>;
  saveRegistry(input: {
    jobId: string;
    baseRevision: number;
    registry: DecompositionRegistryData;
    confirm: boolean;
  }): Promise<z.infer<typeof LongBookDecompositionJobSchema>>;
  listResults(jobId: string): Promise<DecompositionResults>;
  readUnit(jobId: string, unitId: string): Promise<DecompositionUnitView>;
}
