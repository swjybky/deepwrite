import { computed, inject, provide, reactive, type InjectionKey } from "vue";

interface DisclosureContext {
  states: Map<string, boolean>;
  path: () => readonly string[];
}

const DISCLOSURE_CONTEXT: InjectionKey<DisclosureContext> = Symbol(
  "conversation-disclosure"
);

export function provideConversationDisclosureState(
  sessionId: () => string
): void {
  provide(DISCLOSURE_CONTEXT, {
    states: reactive(new Map()),
    path: () => [sessionId()]
  });
}

export function provideConversationDisclosureScope(id: () => string): void {
  const parent = inject(DISCLOSURE_CONTEXT, undefined);
  const states = parent?.states ?? reactive(new Map<string, boolean>());
  provide(DISCLOSURE_CONTEXT, {
    states,
    path: () => [...(parent?.path() ?? []), id()]
  });
}

export function useConversationDisclosure(id: () => string) {
  const parent = inject(DISCLOSURE_CONTEXT, undefined);
  const states = parent?.states ?? reactive(new Map<string, boolean>());
  const path = () => [...(parent?.path() ?? []), id()];
  return computed({
    get: () => states.get(JSON.stringify(path())) ?? false,
    set: (open: boolean) => {
      states.set(JSON.stringify(path()), open);
    }
  });
}
