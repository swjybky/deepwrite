import { createScopedTranslator } from "../i18n";
import type { ModelUsageModule } from "@deepwrite/contracts";

const t = createScopedTranslator("components.modelUsageModuleMeta");
const identityT = createScopedTranslator("extras.bookIdentity");
const decompositionT = createScopedTranslator("extras.longBookDecomposition");
const packT = createScopedTranslator("extras.longMaterialPack");

export const MODULE_META: Record<
  ModelUsageModule,
  { label: string; detail: string }
> = {
  "book-identity": {
    get label() {
      return identityT("title");
    },
    get detail() {
      return identityT("description");
    }
  },
  "long-book-decomposition": {
    get label() {
      return decompositionT("title");
    },
    get detail() {
      return decompositionT("description");
    }
  },
  "long-material-pack": {
    get label() {
      return packT("title");
    },
    get detail() {
      return packT("sidebarDescription");
    }
  },
  "short-writing": {
    get label() {
      return t("shortStoryWriting");
    },
    get detail() {
      return t("shortStoryWorkspace");
    }
  },
  "script-writing": {
    get label() {
      return t("screenplayWriting");
    },
    get detail() {
      return t("screenplayWorkspace");
    }
  },
  "long-writing": {
    get label() {
      return t("novelWriting");
    },
    get detail() {
      return t("novelWorkspace");
    }
  },
  "skill-library": {
    get label() {
      return t("skillLibrary");
    },
    get detail() {
      return t("skillLibraryConversationsAndProcessing");
    }
  },
  "material-library": {
    get label() {
      return t("materialLibrary");
    },
    get detail() {
      return t("materialLibraryConversationsAndProcessing");
    }
  },
  "learning-imitation": {
    get label() {
      return t("learnAndImitateRetired");
    },
    get detail() {
      return t("retiredLearningAndImitationWorkflow");
    }
  },
  "style-comparison": {
    get label() {
      return t("styleComparison");
    },
    get detail() {
      return t("writingStyleSimilarityAnalysisOfTwoTexts");
    }
  },
  "revision-analysis": {
    get label() {
      return t("revisionAnalysis");
    },
    get detail() {
      return t("learnFromManuscriptRevisions");
    }
  },
  "short-book-analysis": {
    get label() {
      return t("shortStoryAnalysis");
    },
    get detail() {
      return t("combinedFullTextShortStoryAnalysis");
    }
  },
  "long-book-analysis": {
    get label() {
      return t("novelAnalysis");
    },
    get detail() {
      return t("novelAnalysisWorkflow");
    }
  },
  "subagent-authoring": {
    get label() {
      return t("subagent");
    },
    get detail() {
      return t("subagentGenerationAndExecution");
    }
  },
  "assistant-chat": {
    get label() {
      return t("chatAssistant");
    },
    get detail() {
      return t("standaloneChatAssistant");
    }
  },
  "model-test": {
    get label() {
      return t("modelTesting");
    },
    get detail() {
      return t("modelConnectionTests");
    }
  },
  unknown: {
    get label() {
      return t("other");
    },
    get detail() {
      return t("uncategorizedModelCalls");
    }
  }
};
