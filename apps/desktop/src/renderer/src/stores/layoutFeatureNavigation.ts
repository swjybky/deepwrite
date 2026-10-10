export type AppView = "workspace" | "settings";

export type WorkspaceMainView =
  | "conversation"
  | "directory"
  | "long-book-analysis"
  | "long-book-decomposition"
  | "long-material-pack"
  | "revision-analysis"
  | "short-book-analysis"
  | "style-comparison"
  | "book-identity"
  | "agent-team"
  | "marketplace"
  | "agent-team-marketplace"
  | "cloud-backup"
  | "device-sync"
  | "zhuque-detection";

export type PrimaryFeature =
  | "directory"
  | "long-book-analysis"
  | "long-book-decomposition"
  | "long-material-pack"
  | "revision-analysis"
  | "short-book-analysis"
  | "style-comparison"
  | "book-identity"
  | "chat-assistant"
  | "agent-teams"
  | "skill-marketplace"
  | "agent-team-marketplace"
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
    case "agent-team-marketplace":
    case "device-sync":
    case "cloud-backup":
    case "zhuque-detection":
    case "directory":
    case "long-book-analysis":
    case "long-book-decomposition":
    case "long-material-pack":
    case "revision-analysis":
    case "short-book-analysis":
    case "style-comparison":
    case "book-identity":
      return view;
    default:
      return undefined;
  }
}
