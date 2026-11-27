import type { DeepWriteApi } from "@deepwrite/contracts/renderer";
export function createBookAnalysisTestApi(): Pick<
  DeepWriteApi,
  "extrasAgents" | "shortBookAnalysis" | "longBookAnalysis"
> &
  Pick<DeepWriteApi, "longBookDecomposition"> {
  const unused = (): never => {
    throw new Error("Extras agents are not used by conversation tests.");
  };
  return {
    longBookDecomposition: {
      createJob: async () => unused(),
      listJobs: async () => unused(),
      getJob: async () => unused(),
      control: async () => unused(),
      updateModels: async () => unused(),
      getRegistry: async () => unused(),
      saveRegistry: async () => unused(),
      listResults: async () => unused(),
      readUnit: async () => unused()
    },
    extrasAgents: {
      run: async () => unused(),
      profiles: {
        list: async () => unused(),
        save: async () => unused(),
        reset: async () => unused()
      }
    },
    shortBookAnalysis: {
      chooseSources: async () => null,
      addText: async () => {
        throw new Error("not used");
      },
      sources: {
        list: async () => ({ sources: [] }),
        delete: async (sourceId) => sourceId,
        load: async () => {
          throw new Error("not used");
        }
      }
    },
    longBookAnalysis: {
      async chooseSource() {
        throw new Error(
          "Long book analysis is not used by conversation tests."
        );
      },
      sources: {
        async list() {
          throw new Error(
            "Long book analysis is not used by conversation tests."
          );
        },
        async load() {
          throw new Error(
            "Long book analysis is not used by conversation tests."
          );
        },
        save: async () => unused(),
        delete: async () => unused(),
        confirm: async () => unused()
      }
    }
  };
}
