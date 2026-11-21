import { computed, type Ref } from "vue";
import type { LongWorkspaceRoot } from "@deepwrite/contracts";
import type { AgentConversationController } from "./useAgentConversation";
import type { CurrentAgentActivityView } from "../types/agentActivity";
import { LONG_WORKSPACE_ROOT_LABELS } from "../utils/longWorkspaceResourceTree";

interface CurrentAgentActivityViewOptions {
  activeFeature: Readonly<Ref<string>>;
  shortResourceId: Readonly<Ref<string>>;
  longResourceId: Readonly<Ref<string>>;
  shortConversation: Readonly<Ref<AgentConversationController>>;
  shortContext: Readonly<
    Ref<{
      agentLabel: string;
      bookTitle: string;
      contextTitle: string;
    }>
  >;
  longConversation: Readonly<Ref<AgentConversationController | null>>;
  longProfile: Readonly<Ref<{ label: string } | null>>;
  longBook: Readonly<Ref<{ title: string } | null>>;
  longSelection: Readonly<
    Ref<{ title: string; chapterCardId?: string } | null>
  >;
  longRoot: Readonly<Ref<LongWorkspaceRoot>>;
}

function joinedContext(primary: string, secondary: string): string {
  return primary === secondary ? primary : [primary, secondary].join(" · ");
}

export function useCurrentAgentActivityView(
  options: CurrentAgentActivityViewOptions
) {
  return computed<CurrentAgentActivityView | null>(() => {
    if (options.activeFeature.value === "long-workspace") {
      const controller = options.longConversation.value;
      const profile = options.longProfile.value;
      const book = options.longBook.value;
      if (!controller || !profile || !book) return null;
      const chapterCardId = options.longSelection.value?.chapterCardId;
      return {
        controller,
        agentLabel: profile.label,
        contextLabel: joinedContext(
          book.title,
          options.longSelection.value?.title ??
            LONG_WORKSPACE_ROOT_LABELS[options.longRoot.value]
        ),
        targetResourceId: options.longResourceId.value,
        ...(chapterCardId ? { chapterCardId } : {}),
        ...(chapterCardId && options.longRoot.value === "plot_design"
          ? { chapterCardView: "card" }
          : {})
      };
    }
    if (options.activeFeature.value !== "conversation") return null;
    const context = options.shortContext.value;
    return {
      controller: options.shortConversation.value,
      agentLabel: context.agentLabel,
      contextLabel: joinedContext(context.bookTitle, context.contextTitle),
      targetResourceId: options.shortResourceId.value
    };
  });
}
