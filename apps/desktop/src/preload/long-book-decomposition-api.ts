import {
  createEnvelope,
  DecompositionControlInputSchema,
  DecompositionJobActionSchema,
  DecompositionUnitActionSchema,
  DecompositionUnitViewSchema,
  CreateDecompositionJobInputSchema,
  UpdateDecompositionModelsInputSchema,
  DecompositionSaveRegistryInputSchema,
  LongBookDecompositionJobSchema,
  DecompositionJobsSchema,
  DecompositionRegistrySchema,
  DecompositionResultsSchema,
  type LongBookDecompositionApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export const longBookDecompositionApi: LongBookDecompositionApi = {
  async createJob(raw) {
    const id = browserId("cmd_decomposition_create");
    return LongBookDecompositionJobSchema.parse(
      await invokeCommand(
        createEnvelope(
          "longBookDecomposition.createJob",
          CreateDecompositionJobInputSchema.parse(raw),
          { id, correlationId: id }
        )
      )
    );
  },
  async listJobs() {
    const id = browserId("cmd_decomposition_list");
    return DecompositionJobsSchema.parse(
      await invokeCommand(
        createEnvelope(
          "longBookDecomposition.listJobs",
          {},
          { id, correlationId: id }
        )
      )
    );
  },
  async getJob(jobId) {
    const id = browserId("cmd_decomposition_get");
    return LongBookDecompositionJobSchema.parse(
      await invokeCommand(
        createEnvelope(
          "longBookDecomposition.getJob",
          DecompositionJobActionSchema.parse({ jobId }),
          { id, correlationId: id }
        )
      )
    );
  },
  async control(raw) {
    const id = browserId("cmd_decomposition_control");
    return LongBookDecompositionJobSchema.nullable().parse(
      await invokeCommand(
        createEnvelope(
          "longBookDecomposition.control",
          DecompositionControlInputSchema.parse(raw),
          { id, correlationId: id }
        )
      )
    );
  },
  async updateModels(raw) {
    const id = browserId("cmd_decomposition_models");
    return LongBookDecompositionJobSchema.parse(
      await invokeCommand(
        createEnvelope(
          "longBookDecomposition.updateModels",
          UpdateDecompositionModelsInputSchema.parse(raw),
          { id, correlationId: id }
        )
      )
    );
  },
  async getRegistry(jobId) {
    const id = browserId("cmd_decomposition_registry");
    return DecompositionRegistrySchema.parse(
      await invokeCommand(
        createEnvelope(
          "longBookDecomposition.getRegistry",
          DecompositionJobActionSchema.parse({ jobId }),
          { id, correlationId: id }
        )
      )
    );
  },
  async saveRegistry(raw) {
    const id = browserId("cmd_decomposition_registry_save");
    return LongBookDecompositionJobSchema.parse(
      await invokeCommand(
        createEnvelope(
          "longBookDecomposition.saveRegistry",
          DecompositionSaveRegistryInputSchema.parse(raw),
          { id, correlationId: id }
        )
      )
    );
  },
  async listResults(jobId) {
    const id = browserId("cmd_decomposition_results");
    return DecompositionResultsSchema.parse(
      await invokeCommand(
        createEnvelope(
          "longBookDecomposition.listResults",
          DecompositionJobActionSchema.parse({ jobId }),
          { id, correlationId: id }
        )
      )
    );
  },
  async readUnit(jobId, unitId) {
    const id = browserId("cmd_decomposition_unit");
    return DecompositionUnitViewSchema.parse(
      await invokeCommand(
        createEnvelope(
          "longBookDecomposition.readUnit",
          DecompositionUnitActionSchema.parse({ jobId, unitId }),
          { id, correlationId: id }
        )
      )
    );
  }
};
