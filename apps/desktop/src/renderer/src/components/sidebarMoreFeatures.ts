import { createScopedTranslator } from "../i18n";
import type { IconName } from "../types/workspace";
import type { MoreFeatureId, MoreFeaturesSettings } from "@deepwrite/contracts";

const t = createScopedTranslator("components.sidebarMoreFeatures");
const identityT = createScopedTranslator("extras.bookIdentity");
const decompositionT = createScopedTranslator("extras.longBookDecomposition");
const packT = createScopedTranslator("extras.longMaterialPack");
export const moreFeatures: Array<{
  id: MoreFeatureId;
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    id: "chat-assistant",
    get label() {
      return t("chat");
    },
    get description() {
      return t("openStandaloneChatAssistant");
    },
    icon: "message"
  },
  {
    id: "short-book-analysis",
    get label() {
      return t("shortStoryAnalysis");
    },
    get description() {
      return t("analyzeFullWorksCombiningUpTo10Books");
    },
    icon: "book"
  },
  {
    id: "long-book-analysis",
    get label() {
      return t("novelAnalysis");
    },
    get description() {
      return t("extractNovelPlotCharactersAndStyleInBatches");
    },
    icon: "book"
  },
  {
    id: "long-book-decomposition",
    get label() {
      return decompositionT("title");
    },
    get description() {
      return decompositionT("description");
    },
    icon: "book"
  },
  {
    id: "long-material-pack",
    get label() {
      return packT("title");
    },
    get description() {
      return packT("sidebarDescription");
    },
    icon: "library"
  },
  {
    id: "revision-analysis",
    get label() {
      return t("revisionAnalysis");
    },
    get description() {
      return t("learnReusableSkillsFromManuscriptRevisions");
    },
    icon: "file"
  },
  {
    id: "style-comparison",
    get label() {
      return t("styleComparison");
    },
    get description() {
      return t("compareTheStyleAndSimilarityOfTwoTexts");
    },
    icon: "file"
  },
  {
    id: "book-identity",
    get label() {
      return identityT("title");
    },
    get description() {
      return identityT("description");
    },
    icon: "image"
  },
  {
    id: "agent-team-marketplace",
    get label() {
      return t("agentTeamMarketplace");
    },
    get description() {
      return t("discoverInstallAndPublishWholeAgentTeams");
    },
    icon: "brain"
  },
  {
    id: "skill-marketplace",
    get label() {
      return t("skillMarketplace");
    },
    get description() {
      return t("discoverInstallAndPublishWritingSkills");
    },
    icon: "globe"
  },
  {
    id: "device-sync",
    get label() {
      return t("deviceSync");
    },
    get description() {
      return t("continueWritingUsingYourOwnCloudDrive");
    },
    icon: "archive"
  },
  {
    id: "cloud-backup",
    get label() {
      return t("cloudBackup");
    },
    get description() {
      return t("backUpTheWorkspaceAndReferences");
    },
    icon: "archive"
  },
  {
    id: "zhuque-detection",
    get label() {
      return t("aITextDetection");
    },
    get description() {
      return t("detectAIGeneratedText");
    },
    icon: "globe"
  }
];

const featureById = new Map(
  moreFeatures.map((feature) => [feature.id, feature])
);

export function configuredMoreFeatures(settings: MoreFeaturesSettings) {
  return settings.map((preference) => ({
    ...preference,
    feature: featureById.get(preference.id)!
  }));
}
