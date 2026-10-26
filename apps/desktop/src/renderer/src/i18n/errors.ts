import {
  ErrorPayloadSchema,
  getModelContentBlockReason
} from "@deepwrite/contracts/renderer";
import type { ErrorPayload } from "@deepwrite/contracts";
import type { TranslationKey } from "./messages";
import { locale, t } from "./index";

const errorKeys: Readonly<Record<string, TranslationKey>> = {
  "catalog.conflict": "foundation.catalogConflict",
  "long.operation.impact_mismatch": "foundation.impactChanged",
  "long.operation.not_found": "foundation.targetNotFound",
  "long.operation.already_exists": "foundation.targetExists",
  "long.operation.invalid_reference": "foundation.invalidReference",
  "long.operation.invalid_order": "foundation.invalidOrder",
  "long.operation.recorded_chapter_order": "foundation.recordedChapterOrder",
  "long.operation.invalid_document_write": "foundation.invalidDocumentWrite",
  "long.operation.invalid_result": "foundation.invalidOperationResult",
  "long.ledger.audit_failed": "foundation.ledgerAuditFailed"
};

/** Diagnostics stay on the rejected payload; presentation never parses translated prose. */
export function getErrorPayload(error: unknown): ErrorPayload | undefined {
  const parsed = ErrorPayloadSchema.safeParse(error);
  return parsed.success ? parsed.data : undefined;
}

export function getErrorCode(error: unknown): string | undefined {
  return getErrorPayload(error)?.code;
}

const MAX_ERROR_DETAIL_LENGTH = 240;

/** Keep stored provider diagnostics intact and localize only their display. */
export function formatModelProviderError(message: string): string {
  const reason = getModelContentBlockReason(message);
  return reason ? t("foundation.modelContentBlocked", { reason }) : message;
}

/**
 * Remote diagnostics (provider responses, network failures) cannot be
 * translated by code, so `formatError` falls back to the caller's headline.
 * Callers whose failure reason is the useful part append this detail instead.
 */
export function getErrorDetail(error: unknown): string | undefined {
  const raw =
    getErrorPayload(error)?.message ??
    (error instanceof Error ? error.message : "");
  const detail = formatModelProviderError(raw).replace(/\s+/gu, " ").trim();
  if (!detail) return undefined;
  return detail.length > MAX_ERROR_DETAIL_LENGTH
    ? `${detail.slice(0, MAX_ERROR_DETAIL_LENGTH)}…`
    : detail;
}

export function formatError(error: unknown, fallback: string): string {
  const contentBlockReason = getModelContentBlockReason(error);
  if (contentBlockReason)
    return t("foundation.modelContentBlocked", { reason: contentBlockReason });
  const payload = getErrorPayload(error);
  if (payload) {
    if (payload.code === "session.prompt_budget_exceeded") {
      const { inputTokens, maxInputTokens, budgetTokens } =
        payload.details ?? {};
      if (
        typeof inputTokens === "number" &&
        typeof maxInputTokens === "number" &&
        typeof budgetTokens === "number" &&
        [inputTokens, maxInputTokens, budgetTokens].every(
          (value) => Number.isSafeInteger(value) && value >= 0
        )
      )
        return t("workspace.sendMessage.messageExceedsContextBudget", {
          used: inputTokens.toLocaleString(locale.value),
          limit: maxInputTokens.toLocaleString(locale.value),
          budget: budgetTokens.toLocaleString(locale.value)
        });
      return fallback;
    }
    if (payload.code === "renderer_state.command_failed") {
      const details = payload.details ?? {};
      const code =
        typeof details.storageCode === "string" &&
        /^[a-z][a-z_]{0,63}$/u.test(details.storageCode)
          ? details.storageCode
          : "storage_failed";
      const suffix =
        typeof details.sqliteCode === "number" &&
        Number.isSafeInteger(details.sqliteCode)
          ? `SQLite-${details.sqliteCode}`
          : typeof details.nativeCode === "string" &&
              /^[A-Z][A-Z_0-9]{0,63}$/u.test(details.nativeCode)
            ? details.nativeCode
            : undefined;
      const keys: Readonly<Record<string, TranslationKey>> = {
        permission_denied: "foundation.conversationStoragePermissionDenied",
        disk_full: "foundation.conversationStorageDiskFull",
        database_locked: "foundation.conversationStorageLocked",
        database_corrupt: "foundation.conversationStorageCorrupt",
        location_unavailable:
          "foundation.conversationStorageLocationUnavailable",
        disk_io_failed: "foundation.conversationStorageIoFailed",
        worker_unavailable: "foundation.conversationStorageWorkerUnavailable"
      };
      return t(
        code.startsWith("migration_")
          ? "foundation.conversationStorageMigrationFailed"
          : (keys[code] ?? "foundation.conversationStorageFailed"),
        { code: suffix ? `${code}/${suffix}` : code }
      );
    }
    const key = errorKeys[payload.code];
    return key ? t(key) : error instanceof Error ? error.message : fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
