import {
  ExternalRunRecoverySchema,
  type DeepWriteApi,
  type ExternalRunRecovery
} from "@deepwrite/contracts/renderer";

const key = (runId: string) =>
  `conversation-preferences:external-run:${encodeURIComponent(runId)}`;

export function createExternalRunRecovery(api: () => DeepWriteApi | undefined) {
  let writes = Promise.resolve();
  return {
    flush: () => writes,
    async load(runId: string): Promise<ExternalRunRecovery | undefined> {
      await writes;
      const value = await api()?.conversationPersistence?.load(key(runId));
      if (value === undefined) return undefined;
      const parsed = ExternalRunRecoverySchema.safeParse(value);
      return parsed.success && parsed.data.runId === runId
        ? parsed.data
        : undefined;
    },
    save(value: ExternalRunRecovery): Promise<void> {
      const snapshot = ExternalRunRecoverySchema.parse(
        JSON.parse(JSON.stringify(value))
      );
      const next = writes.then(() =>
        api()?.conversationPersistence?.save(key(snapshot.runId), snapshot)
      );
      writes = next.catch(() => undefined);
      return next;
    }
  };
}
