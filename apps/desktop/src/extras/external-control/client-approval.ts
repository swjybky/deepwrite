import {
  ExternalControlAccessFileSchema,
  type ExternalControlAccessFile,
  type ExternalControlClient
} from "@deepwrite/contracts/external-control";
import { readPrivateJson, writePrivateJson } from "./control-state-file";
import { ExternalControlError } from "./errors";
import { withConfigurationLock } from "../../main/configuration-lock";

/** Answers before the bridge's call timeout; the dialog stays open. */
const APPROVAL_WAIT_MS = 40_000;

interface ClientApprovalOptions {
  accessFile(): string;
  confirm(client: ExternalControlClient): Promise<boolean>;
  now?: () => string;
  waitMs?: number;
}

export function createClientApproval(options: ClientApprovalOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const waitMs = options.waitMs ?? APPROVAL_WAIT_MS;
  const pending = new Map<string, Promise<boolean>>();
  // Until the switch is cycled, so a refused agent cannot keep raising dialogs.
  const refused = new Set<string>();
  async function load(): Promise<ExternalControlAccessFile> {
    return (
      (await readPrivateJson(
        options.accessFile(),
        ExternalControlAccessFileSchema
      )) ?? { version: 1, clients: [] }
    );
  }

  async function remember(name: string): Promise<void> {
    await withConfigurationLock(options.accessFile(), async () => {
      const current = await load();
      if (current.clients.some((client) => client.name === name)) return;
      const access = {
        ...current,
        clients: [...current.clients, { name, approvedAt: now() }]
      };
      await writePrivateJson(options.accessFile(), access);
    });
  }

  function ask(client: ExternalControlClient): Promise<boolean> {
    const existing = pending.get(client.name);
    if (existing) return existing;
    const asking = options
      .confirm(client)
      .then(async (allowed) => {
        if (allowed) await remember(client.name);
        else refused.add(client.name);
        return allowed;
      })
      .finally(() => pending.delete(client.name));
    pending.set(client.name, asking);
    return asking;
  }

  return {
    async list() {
      return (await load()).clients;
    },
    /** The agent is asked about again the next time it connects. */
    async revoke(name: string): Promise<void> {
      await withConfigurationLock(options.accessFile(), async () => {
        const current = await load();
        const access = {
          ...current,
          clients: current.clients.filter((client) => client.name !== name)
        };
        await writePrivateJson(options.accessFile(), access);
      });
    },
    async authorize(client: ExternalControlClient): Promise<void> {
      const { clients } = await load();
      if (clients.some(({ name }) => name === client.name)) return;
      if (refused.has(client.name)) {
        throw new ExternalControlError(
          "external.unauthorized",
          "用户拒绝了这次连接。请让用户在 DeepWrite 设置里关闭再打开外部智能体开关后重试。"
        );
      }
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<"waiting">((resolve) => {
        timer = setTimeout(() => resolve("waiting"), waitMs);
      });
      const decision = await Promise.race([ask(client), timedOut]);
      clearTimeout(timer);
      if (decision === "waiting") {
        throw new ExternalControlError(
          "external.approval_pending",
          "正在等待用户在 DeepWrite 弹窗里确认连接。请让用户确认后重试。"
        );
      }
      if (!decision) {
        throw new ExternalControlError(
          "external.unauthorized",
          "用户拒绝了这次连接。"
        );
      }
    },
    reset(): void {
      refused.clear();
    }
  };
}

export type ClientApproval = ReturnType<typeof createClientApproval>;
