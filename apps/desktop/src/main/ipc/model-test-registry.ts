export interface ActiveModelTestEntry {
  readonly requestId: string;
  readonly ownerId: number | undefined;
  cancelled: boolean;
  dispatchedToAgent: boolean;
}

export type CancelAgentModelTestFn = (requestId: string) => Promise<boolean>;

export class ModelTestRegistry {
  private readonly active = new Map<string, ActiveModelTestEntry>();

  begin(requestId: string, ownerId?: number): boolean {
    if (this.active.has(requestId)) {
      return false;
    }
    this.active.set(requestId, {
      requestId,
      ownerId,
      cancelled: false,
      dispatchedToAgent: false
    });
    return true;
  }

  markDispatched(requestId: string): void {
    const entry = this.active.get(requestId);
    if (entry) {
      entry.dispatchedToAgent = true;
    }
  }

  isCancelled(requestId: string): boolean {
    return this.active.get(requestId)?.cancelled === true;
  }

  finish(requestId: string): void {
    this.active.delete(requestId);
  }

  async cancel(
    requestId: string,
    ownerId: number | undefined,
    cancelInAgent: CancelAgentModelTestFn
  ): Promise<boolean> {
    const entry = this.active.get(requestId);
    if (!entry) return false;
    if (entry.ownerId !== undefined && entry.ownerId !== ownerId) {
      return false;
    }
    entry.cancelled = true;
    if (!entry.dispatchedToAgent) {
      return true;
    }
    return await cancelInAgent(requestId);
  }

  async cancelOwner(
    ownerId: number,
    cancelInAgent: CancelAgentModelTestFn
  ): Promise<void> {
    const targets = [...this.active.values()].filter(
      (entry) => entry.ownerId === ownerId && !entry.cancelled
    );
    await Promise.allSettled(
      targets.map((entry) =>
        this.cancel(entry.requestId, ownerId, cancelInAgent)
      )
    );
  }
}
