import { z } from "zod";
import {
  syncHashSchema,
  syncIdSchema,
  type SyncItem,
  type SyncMetadata
} from "./schemas";

export const syncInitializationPreviewSchema = z
  .object({
    token: syncIdSchema,
    deviceId: syncIdSchema,
    deviceName: z.string().min(1).max(80),
    remoteUpdatedAt: z.string().datetime(),
    remoteHash: syncHashSchema,
    itemCount: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
    localItemCount: z.number().int().nonnegative(),
    expiresAt: z.string().datetime(),
    ignoredDevices: z.array(z.string().min(1).max(80)).optional(),
    skippedUnsupportedCount: z.number().int().nonnegative().optional()
  })
  .strict();
export type SyncInitializationPreview = z.infer<
  typeof syncInitializationPreviewSchema
>;

export interface SyncInitializationWorkspacePort {
  inspect(): Promise<{ fingerprint: string; itemCount: number }>;
  /** Replace all creative data and sync baselines in one recoverable local transaction. */
  replace(
    items: SyncItem[],
    metadata: SyncMetadata,
    expectedFingerprint: string,
    signal: AbortSignal
  ): Promise<void>;
}

export const SYNC_INITIALIZATION_ERRORS = [
  "请先选择另一台已上传数据的设备。",
  "来源设备没有可下载的作品或资料，未清除本机数据。",
  "远端还有未合并的版本，请先在来源设备完成同步后重试。",
  "远端作品不完整或不兼容，请先在来源设备更新并重新上传。",
  "远端作品绑定的资料不完整，请先在来源设备同步全部作品和资料库。",
  "初始化预览已过期，请重新下载预览。",
  "远端数据已更新，请重新下载预览后确认。",
  "本机数据已变化，请重新下载预览后确认。",
  "本机初始化尚未完成，请重启应用恢复。",
  "当前环境不支持初始化本机。"
] as const;
