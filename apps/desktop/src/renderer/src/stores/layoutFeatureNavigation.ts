export type AppView = "workspace" | "settings";

export type WorkspaceMainView =
  | "conversation"
  | "directory"
  | "models"
  | "imitation"
  | "long-book-analysis"
  | "style-comparison"
  | "agent-team"
  | "marketplace"
  | "cloud-backup"
  | "device-sync"
  | "zhuque-detection";

export type PrimaryFeature =
  | "directory"
  | "models"
  | "imitation"
  | "long-book-analysis"
  | "style-comparison"
  | "chat-assistant"
  | "agent-teams"
  | "skill-marketplace"
  | "cloud-backup"
  | "device-sync"
  | "zhuque-detection";

export function primaryFeatureForView(
  view: WorkspaceMainView
): PrimaryFeature | undefined {
  switch (view) {
    case "agent-team":
      return "agent-teams";
    case "marketplace":
      return "skill-marketplace";
    case "device-sync":
    case "cloud-backup":
    case "zhuque-detection":
    case "directory":
    case "models":
    case "imitation":
    case "long-book-analysis":
    case "style-comparison":
      return view;
    default:
      return undefined;
  }
}
