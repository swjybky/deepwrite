import type { Ref } from "vue";

export interface BookLifecyclePendingLease<Lane> {
  readonly lane: Lane;
  readonly requestId: number;
  readonly pending: Ref<boolean>;
}

export function acquireBookLifecycleLease<Lane>(
  leases: Map<Lane, BookLifecyclePendingLease<Lane>>,
  lane: Lane,
  pending: Ref<boolean>,
  nextRequestId: () => number
): BookLifecyclePendingLease<Lane> | null {
  // A pending ref may be owned by another coordinator.
  if (leases.has(lane) || pending.value) return null;
  const lease = { lane, requestId: nextRequestId(), pending };
  leases.set(lane, lease);
  pending.value = true;
  return lease;
}

interface Drainable {
  drain(): Promise<void>;
}

export function drainLoadedCoordinator(
  disposal: Promise<void> | null,
  current: Drainable | null,
  loading: Promise<Drainable | null> | null,
  reportFailure: (error: unknown) => void
): Promise<void> {
  if (disposal) return disposal;
  if (current) return current.drain();
  if (!loading) return Promise.resolve();
  return loading
    .then((loaded) => loaded?.drain())
    .then(() => undefined)
    .catch(reportFailure);
}
