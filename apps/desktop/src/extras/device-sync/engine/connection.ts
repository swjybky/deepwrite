import {
  stableSyncJson,
  syncConfigSchema,
  syncJoinCodeSchema,
  syncMetadataSchema,
  type SyncConfig,
  type SyncMetadata,
  type SyncServiceOptions
} from "@deepwrite/contracts";
import { SyncRemote } from "./remote";

export async function loadSyncMetadata(
  options: SyncServiceOptions
): Promise<SyncMetadata> {
  const stored = await options.metadata.read();
  if (stored) return syncMetadataSchema.parse(stored);
  const value: SyncMetadata = {
    schemaVersion: 1,
    deviceId: options.runtime.id(),
    config: null,
    baselines: {},
    ancestors: {},
    published: null,
    history: [],
    lastSuccessAt: null,
    firstSyncConfirmed: false,
    lastCheckedAt: null,
    devices: [],
    pendingIssues: []
  };
  await options.metadata.write(value);
  return value;
}
export async function connectedSyncRemote(
  options: SyncServiceOptions,
  config: SyncConfig,
  signal?: AbortSignal
): Promise<SyncRemote> {
  const password = await options.credentials.get();
  if (!password) throw new Error("请在连接设置中重新填写应用密码。");
  return new SyncRemote(
    options.transport(config, password),
    options.runtime,
    signal
  );
}
export async function connectSync(
  options: SyncServiceOptions,
  input: SyncConfig,
  password: string
) {
  const config = syncConfigSchema.parse(input);
  const metadata = await loadSyncMetadata(options);
  const sameAccount =
    metadata.config &&
    ["endpoint", "username"].every(
      (key) =>
        Reflect.get(metadata.config ?? {}, key) === Reflect.get(config, key)
    );
  const credential =
    password || (sameAccount ? await options.credentials.get() : null);
  if (!credential) throw new Error("请填写应用密码。");
  const transport = options.transport(config, credential);
  await transport.test();
  const remote = new SyncRemote(transport, options.runtime);
  const spaces = await remote.spaces();
  const previousPassword = await options.credentials.get();
  const sameSpace =
    metadata.config &&
    ["endpoint", "username", "directory", "spaceId"].every(
      (key) =>
        Reflect.get(metadata.config ?? {}, key) === Reflect.get(config, key)
    );
  await options.credentials.set(credential);
  try {
    await options.metadata.write({
      ...metadata,
      config,
      ...(sameSpace
        ? {}
        : {
            baselines: {},
            ancestors: {},
            published: null,
            firstSyncConfirmed: false,
            lastSuccessAt: null,
            devices: [],
            pendingIssues: [],
            lastCheckedAt: null
          })
    });
  } catch (error) {
    if (previousPassword) await options.credentials.set(previousPassword);
    else await options.credentials.delete();
    throw error;
  }
  return spaces;
}
export function syncJoinCode(config: SyncConfig): string {
  if (!config.spaceId) throw new Error("请先建立或加入同步空间。");
  const { provider, endpoint, username, directory, spaceId } = config;
  return stableSyncJson(
    syncJoinCodeSchema.parse({
      schemaVersion: 1,
      kind: "deepwrite.sync.join",
      config: { provider, endpoint, username, directory, spaceId }
    })
  );
}

export async function configureSync(
  options: SyncServiceOptions,
  metadata: SyncMetadata,
  input: SyncConfig
): Promise<void> {
  const config = syncConfigSchema.parse(input);
  if (
    !metadata.config ||
    !["endpoint", "username", "directory", "spaceId", "provider"].every(
      (key) =>
        Reflect.get(metadata.config ?? {}, key) === Reflect.get(config, key)
    )
  )
    throw new Error("修改连接请重新验证网盘。");
  await options.metadata.write({ ...metadata, config });
}
