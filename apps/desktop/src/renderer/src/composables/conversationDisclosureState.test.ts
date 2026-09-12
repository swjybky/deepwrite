import {
  defineComponent,
  h,
  nextTick,
  ref,
  type WritableComputedRef
} from "vue";
import { describe, expect, it } from "vitest";
import {
  provideConversationDisclosureScope,
  provideConversationDisclosureState,
  useConversationDisclosure
} from "./conversationDisclosureState";
import { mountConversationTestComponent } from "./conversation-view.test-support";

describe("conversation disclosure state", () => {
  it("survives details remounts and restores each session independently", async () => {
    const sessionId = ref("session-1");
    const visible = ref(true);
    let open: WritableComputedRef<boolean>;
    const Detail = defineComponent({
      setup() {
        open = useConversationDisclosure(() => "tool-1");
        return () => null;
      }
    });
    const Message = defineComponent({
      setup() {
        provideConversationDisclosureScope(() => "message-1");
        return () => (visible.value ? h(Detail) : null);
      }
    });
    const Parent = defineComponent({
      setup() {
        provideConversationDisclosureState(() => sessionId.value);
        return () => h(Message);
      }
    });
    const unmount = mountConversationTestComponent(Parent);
    expect(open!.value).toBe(false);
    open!.value = true;
    visible.value = false;
    await nextTick();
    visible.value = true;
    await nextTick();
    expect(open!.value).toBe(true);
    sessionId.value = "session-2";
    expect(open!.value).toBe(false);
    sessionId.value = "session-1";
    expect(open!.value).toBe(true);
    unmount();
  });
});
