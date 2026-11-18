import { computed, type Ref } from "vue";
import {
  rightPanePreferenceKey,
  type RightPaneBookDocument
} from "../utils/rightPanePreferences";

export function useBookPanePreferenceKey(options: {
  document: Readonly<Ref<RightPaneBookDocument>>;
  longWorkspaceActive: Readonly<Ref<boolean>>;
  longBookId: Readonly<Ref<string | null>>;
  mysteryBookId?: Readonly<Ref<string | null>> | undefined;
}) {
  return computed(() => {
    if (options.mysteryBookId?.value) {
      return rightPanePreferenceKey({
        domain: "creation",
        workspaceType: "mystery",
        workspaceId: options.mysteryBookId.value
      });
    }
    if (options.longWorkspaceActive.value) {
      return rightPanePreferenceKey({
        domain: "creation",
        workspaceType: "long",
        workspaceId: options.longBookId.value ?? ""
      });
    }
    return rightPanePreferenceKey(options.document.value);
  });
}
