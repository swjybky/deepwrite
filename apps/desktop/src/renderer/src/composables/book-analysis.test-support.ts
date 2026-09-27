import type { DeepWriteApi } from "@deepwrite/contracts/renderer";
export function createBookAnalysisTestApi(): Pick<
  DeepWriteApi,
  "revisionAnalysis" | "shortBookAnalysis" | "longBookAnalysis"
> {
  return {
    revisionAnalysis: {
      list: async () => ({ systemPrompt: "测试方法" }),
      save: async (input) => input,
      reset: async () => ({ systemPrompt: "测试方法" })
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
      },
      presets: {
        list: async () => ({ presets: [] }),
        save: async (input) => input,
        reset: async () => ({ presets: [] })
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
        }
      },
      presets: {
        async list() {
          throw new Error(
            "Long book analysis is not used by conversation tests."
          );
        },
        async save() {
          throw new Error(
            "Long book analysis is not used by conversation tests."
          );
        },
        async reset() {
          throw new Error(
            "Long book analysis is not used by conversation tests."
          );
        }
      },
      plans: {
        async list() {
          throw new Error("Long book analysis is not used by conversation tests.");
        },
        async save() {
          throw new Error("Long book analysis is not used by conversation tests.");
        },
        async remove() {
          throw new Error("Long book analysis is not used by conversation tests.");
        }
      }
    }
  };
}
