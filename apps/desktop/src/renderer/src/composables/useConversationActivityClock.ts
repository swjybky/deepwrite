import { onScopeDispose, ref, watch } from "vue";

export function useConversationActivityClock(active: () => boolean) {
  const now = ref(Date.now());
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  function stop(): void {
    if (timer !== undefined) globalThis.clearInterval(timer);
    timer = undefined;
  }
  watch(
    active,
    (running) => {
      stop();
      now.value = Date.now();
      if (running)
        timer = globalThis.setInterval(() => {
          now.value = Date.now();
        }, 1_000);
    },
    { immediate: true }
  );
  onScopeDispose(stop);
  return now;
}
