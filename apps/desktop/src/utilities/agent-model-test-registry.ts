export class AgentModelTestRegistry {
  private readonly controllers = new Map<string, AbortController>();
  private readonly cancelledIds = new Set<string>();

  begin(requestId: string): { signal: AbortSignal } | undefined {
    if (this.controllers.has(requestId)) {
      return undefined;
    }
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    return { signal: controller.signal };
  }

  cancel(requestId: string): boolean {
    const controller = this.controllers.get(requestId);
    if (!controller) return false;
    this.cancelledIds.add(requestId);
    controller.abort();
    return true;
  }

  wasCancelled(requestId: string): boolean {
    return this.cancelledIds.has(requestId);
  }

  finish(requestId: string): void {
    this.controllers.delete(requestId);
    this.cancelledIds.delete(requestId);
  }

  abortAll(): void {
    for (const [requestId, controller] of this.controllers) {
      this.cancelledIds.add(requestId);
      controller.abort();
    }
  }
}
