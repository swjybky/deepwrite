import { z } from "zod";
import {
  syncIssueSchema,
  syncConfigSchema,
  syncItemSchema,
  syncSpaceSchema
} from "./schemas";
import type { SyncApi } from "./types";

export const syncResolutionSchema = z
  .object({ token: z.string().min(1), item: syncItemSchema.nullable() })
  .strict();
export const syncAdoptionSchema = z
  .object({
    side: z.enum(["local", "remote"]),
    keys: z.array(z.string().min(1).max(1024)).min(1)
  })
  .strict();
export const syncRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("status") }).strict(),
  z.object({ operation: z.literal("check") }).strict(),
  z
    .object({
      operation: z.literal("connect"),
      config: syncConfigSchema,
      password: z.string().max(4096)
    })
    .strict(),
  z
    .object({
      operation: z.literal("join"),
      spaceId: z.string().nullable(),
      name: z.string().optional()
    })
    .strict(),
  z
    .object({ operation: z.literal("configure"), config: syncConfigSchema })
    .strict(),
  z.object({ operation: z.literal("code") }).strict(),
  z
    .object({
      operation: z.literal("sync"),
      resolutions: z.array(syncResolutionSchema).optional(),
      confirmFirst: z.boolean().optional(),
      direction: z.enum(["both", "upload", "download"]).optional(),
      adoption: syncAdoptionSchema.optional()
    })
    .strict(),
  z.object({ operation: z.literal("cancel") }).strict(),
  z.object({ operation: z.literal("restore"), historyId: z.string() }).strict()
]);
export const syncStatusSchema = z
  .object({
    config: syncConfigSchema.nullable(),
    credentialSaved: z.boolean(),
    deviceId: z.string(),
    lastSuccessAt: z.string().nullable(),
    lastCheckedAt: z.string().nullable(),
    firstSyncConfirmed: z.boolean(),
    progress: z
      .object({
        phase: z.enum([
          "idle",
          "saving",
          "checking",
          "transferring",
          "applying",
          "complete",
          "partial",
          "cancelled",
          "failed"
        ]),
        completed: z.number(),
        total: z.number(),
        title: z.string(),
        filesCompleted: z.number().optional(),
        filesTotal: z.number().optional()
      })
      .strict(),
    items: z.array(
      z
        .object({
          key: z.string(),
          title: z.string(),
          kind: syncItemSchema.shape.kind,
          included: z.boolean(),
          dirty: z.boolean(),
          remoteDirty: z.boolean()
        })
        .strict()
    ),
    issues: z.array(syncIssueSchema),
    devices: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          updatedAt: z.string(),
          receivedCurrent: z.boolean()
        })
        .strict()
    ),
    history: z.array(
      z
        .object({
          id: z.string(),
          key: z.string(),
          title: z.string(),
          at: z.string(),
          description: z.string(),
          canRestore: z.boolean()
        })
        .strict()
    )
  })
  .strict();
export const syncResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), status: syncStatusSchema }).strict(),
  z
    .object({ kind: z.literal("spaces"), spaces: z.array(syncSpaceSchema) })
    .strict(),
  z.object({ kind: z.literal("code"), code: z.string() }).strict(),
  z.object({ kind: z.literal("cancelled") }).strict()
]);
export type SyncRequest = z.infer<typeof syncRequestSchema>;
export type SyncResponse = z.infer<typeof syncResponseSchema>;
export async function dispatchSyncRequest(
  api: SyncApi,
  raw: SyncRequest
): Promise<SyncResponse> {
  const request = syncRequestSchema.parse(raw);
  switch (request.operation) {
    case "status":
      return { kind: "status", status: await api.status() };
    case "check":
      return { kind: "status", status: await api.check() };
    case "connect":
      return {
        kind: "spaces",
        spaces: await api.connect(request.config, request.password)
      };
    case "join":
      return {
        kind: "status",
        status: await api.join(request.spaceId, request.name)
      };
    case "configure":
      return { kind: "status", status: await api.configure(request.config) };
    case "code":
      return { kind: "code", code: await api.joinCode() };
    case "sync":
      return {
        kind: "status",
        status: await api.sync(
          request.resolutions,
          request.confirmFirst,
          request.direction,
          request.adoption
        )
      };
    case "restore":
      return { kind: "status", status: await api.restore(request.historyId) };
    case "cancel":
      api.cancel();
      return { kind: "cancelled" };
  }
}
export function syncErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const allowed = [
    "网盘账号或应用密码不正确。",
    "没有访问该同步目录的权限。",
    "服务器不支持所需的 WebDAV 操作。",
    "文件超过网盘允许的大小。",
    "网盘请求过于频繁，请稍后重试。",
    "网盘空间不足，请清理后重试。",
    "连接网盘超时，请重试。",
    "无法连接网盘，请检查网络和服务器地址。",
    "无法解析网盘服务器地址，请检查地址和 DNS 设置。",
    "网盘安全证书验证失败，请检查服务器证书和系统时间。",
    "无法通过代理连接网盘，请检查系统代理设置。",
    "网盘连接被拒绝或中断，请检查网络后重试。",
    "网盘重定向地址不安全，请填写服务商提供的 HTTPS WebDAV 直连地址。",
    "网盘重定向次数过多，请检查服务器地址。",
    "网盘读写验证失败。",
    "同步已取消。",
    "请填写有效的 HTTPS 地址、账号和同步目录。",
    "请先连接网盘。",
    "请先建立或加入同步空间。",
    "请填写应用密码。",
    "请在连接设置中重新填写应用密码。",
    "同步正在进行，请稍候。",
    "作品正在生成或保存，请完成后再同步。",
    "正文保存失败，请先保存后同步。",
    "正文已发生新修改，请重新同步。",
    "请先连接并选择同步空间。",
    "修改连接请重新验证网盘。",
    "设备同步记录损坏，请从历史恢复。",
    "设备同步记录无法验证。",
    "服务器未返回有效的 WebDAV 目录。",
    "网盘目录不完整。",
    "网盘目录部分读取失败。",
    "网盘目录缺少文件路径。",
    "网盘返回了目录以外的路径。",
    "网盘目录路径无效。",
    "网盘目录编码无效。",
    "网盘分页重复，未使用不完整目录。",
    "网盘目录可能被截断，未使用不完整列表。",
    "网盘分页地址无效。",
    "网盘目录分页过多。",
    "同步文件超过安全读取限制。",
    "系统安全存储不可用。"
  ];
  return allowed.includes(message) ||
    /^网盘请求失败（[1-5]\d{2}），请稍后重试。$/.test(message)
    ? message
    : "同步未完成，请检查连接、作品保存状态后重试。";
}
