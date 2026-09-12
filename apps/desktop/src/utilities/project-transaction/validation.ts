import { isAbsolute } from "node:path";
import {
  INTERNAL_DIRECTORY,
  TRANSACTION_DIRECTORY,
  MAX_TRANSACTION_FILES,
  type ProjectTransactionFileOperation,
  type JournalOperation,
  type TransactionJournal
} from "./types";

export function validateOperations(
  rawOperations: readonly ProjectTransactionFileOperation[],
  maxFileBytes: number
): ProjectTransactionFileOperation[] {
  if (
    rawOperations.length < 1 ||
    rawOperations.length > MAX_TRANSACTION_FILES
  ) {
    throw new Error(`项目事务必须包含 1 到 ${MAX_TRANSACTION_FILES} 个文件。`);
  }
  const normalized = rawOperations.map((operation) => {
    const path = validateBusinessProjectPath(operation.path);
    if (
      operation.action === "check" &&
      operation.expectedSha256 === undefined
    ) {
      throw new Error(`项目事务只校验操作必须包含 revision：${path}`);
    }
    if (
      operation.expectedSha256 !== undefined &&
      operation.expectedSha256 !== null &&
      !/^[0-9a-f]{64}$/u.test(operation.expectedSha256)
    ) {
      throw new Error(`项目事务文件 revision 格式无效：${path}`);
    }
    if (operation.action === "delete") {
      return { ...operation, action: "delete" as const, path };
    }
    if (operation.action === "check") {
      return { ...operation, action: "check" as const, path };
    }
    if (Buffer.byteLength(operation.content, "utf8") > maxFileBytes) {
      throw new Error(`项目事务文件超过大小限制：${path}`);
    }
    return { ...operation, action: "write" as const, path };
  });
  const keys = normalized.map(({ path }) =>
    path.normalize("NFC").toLocaleLowerCase("en-US")
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error("项目事务不能包含重复或大小写等价的文件路径。");
  }
  return normalized;
}

export function validateRelativeProjectPath(value: string): string {
  const path = value.trim();
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("项目事务路径必须是规范化的项目内相对路径。");
  }
  return path;
}

export function validateBusinessProjectPath(value: string): string {
  const path = validateRelativeProjectPath(value);
  if (
    path === INTERNAL_DIRECTORY ||
    path.startsWith(`${INTERNAL_DIRECTORY}/`)
  ) {
    throw new Error("业务文件不能写入 DeepWrite 内部事务目录。");
  }
  return path;
}

export function parseJournal(text: string): TransactionJournal {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("项目事务日志不是有效 JSON。");
  }
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("项目事务日志版本无效。");
  }
  const transactionId = parseTransactionId(value.transactionId);
  if (
    value.phase !== "prepared" &&
    value.phase !== "committing" &&
    value.phase !== "committed"
  ) {
    throw new Error("项目事务日志阶段无效。");
  }
  if (
    !Number.isSafeInteger(value.appliedCount) ||
    (value.appliedCount as number) < 0
  ) {
    throw new Error("项目事务日志进度无效。");
  }
  if (
    !Array.isArray(value.operations) ||
    value.operations.length < 1 ||
    value.operations.length > MAX_TRANSACTION_FILES
  ) {
    throw new Error("项目事务日志操作列表无效。");
  }
  const operations = value.operations.map((raw, index): JournalOperation => {
    if (!isRecord(raw)) {
      throw new Error(`项目事务日志操作 ${index} 无效。`);
    }
    const path = validateBusinessProjectPath(stringField(raw.path, "path"));
    const action =
      raw.action === undefined || raw.action === "write"
        ? "write"
        : raw.action === "delete"
          ? "delete"
          : raw.action === "check"
            ? "check"
            : undefined;
    if (!action) {
      throw new Error(`项目事务日志操作 ${index} 的动作无效。`);
    }
    const stagePath =
      action === "write"
        ? validateInternalTransactionPath(
            stringField(raw.stagePath, "stagePath"),
            transactionId
          )
        : raw.stagePath === null || raw.stagePath === undefined
          ? null
          : (() => {
              throw new Error(
                `项目事务日志 ${action} 操作 ${index} 不能包含暂存写文件。`
              );
            })();
    const backupPath =
      action === "check"
        ? raw.backupPath === null || raw.backupPath === undefined
          ? null
          : (() => {
              throw new Error(
                `项目事务日志只校验操作 ${index} 不能包含备份文件。`
              );
            })()
        : validateInternalTransactionPath(
            stringField(raw.backupPath, "backupPath"),
            transactionId
          );
    const beforeSha256 =
      raw.beforeSha256 === null
        ? null
        : validateSha256(stringField(raw.beforeSha256, "beforeSha256"));
    const afterSha256 =
      action === "write"
        ? validateSha256(stringField(raw.afterSha256, "afterSha256"))
        : action === "check"
          ? raw.afterSha256 === null
            ? null
            : validateSha256(stringField(raw.afterSha256, "afterSha256"))
          : raw.afterSha256 === null || raw.afterSha256 === undefined
            ? null
            : (() => {
                throw new Error(
                  `项目事务日志删除操作 ${index} 的结果哈希必须为空。`
                );
              })();
    if (action === "check" && afterSha256 !== beforeSha256) {
      throw new Error(`项目事务日志只校验操作 ${index} 的前后哈希必须一致。`);
    }
    return {
      action,
      path,
      stagePath,
      backupPath,
      beforeSha256,
      afterSha256
    };
  });
  if ((value.appliedCount as number) > operations.length) {
    throw new Error("项目事务日志进度超出操作数量。");
  }
  return {
    schemaVersion: 1,
    transactionId,
    phase: value.phase,
    appliedCount: value.appliedCount as number,
    operations
  };
}

export function validateInternalTransactionPath(
  value: string,
  transactionId: string
): string {
  const path = validateRelativeProjectPath(value);
  const prefix = `${INTERNAL_DIRECTORY}/${TRANSACTION_DIRECTORY}/${transactionId}/`;
  if (!path.startsWith(prefix)) {
    throw new Error("项目事务日志引用了事务目录外的内部文件。");
  }
  return path;
}

export function parseTransactionId(value: unknown): string {
  if (typeof value !== "string" || !/^txn-[0-9]+-[0-9a-f]{8}$/u.test(value)) {
    throw new Error("项目事务标识无效。");
  }
  return value;
}

export function validateSha256(value: string): string {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error("项目事务哈希无效。");
  }
  return value;
}

export function stringField(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`项目事务日志字段 ${name} 无效。`);
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
