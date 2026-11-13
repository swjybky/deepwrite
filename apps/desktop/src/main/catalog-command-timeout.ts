import type { CommandEnvelope } from "@deepwrite/contracts";

export const CATALOG_INTERACTIVE_COMMAND_TIMEOUT_MS = 60_000;

const CATALOG_INTERACTIVE_WRITE_COMMANDS = new Set<CommandEnvelope["type"]>([
  "catalog.saveDocument",
  "versions.restore",
  "catalog.writeWritingContext",
  "catalog.updateLibrary",
  "catalog.saveLibraryEntry",
  "catalog.createLibraryEntry",
  "catalog.mutatePlotStructure",
  "catalog.mutateCharacterStructure",
  "catalog.createDraftSection",
  "catalog.createDraftSections",
  "catalog.deleteDraftSection",
  "catalog.moveDraftSection"
]);

const CATALOG_INTERACTIVE_READ_COMMANDS = new Set<CommandEnvelope["type"]>([
  "catalog.snapshot",
  "versions.list",
  "versions.read",
  "catalog.index",
  "catalog.readDocument",
  "catalog.readWritingContext"
]);

/**
 * Bound catalog calls that sit directly on the editor startup/read/approval
 * path. Approval writes must return control to the renderer queue even when
 * the Core utility or the project disk stops responding.
 *
 * Other catalog operations keep their existing unlimited timeout because
 * project import, duplication, and deletion can legitimately take longer on
 * large external folders.
 */
export function catalogCommandTimeoutMs(
  commandType: CommandEnvelope["type"]
): number {
  return CATALOG_INTERACTIVE_WRITE_COMMANDS.has(commandType) ||
    CATALOG_INTERACTIVE_READ_COMMANDS.has(commandType)
    ? CATALOG_INTERACTIVE_COMMAND_TIMEOUT_MS
    : 0;
}

export function catalogCommandTimeoutMessage(
  commandType: CommandEnvelope["type"]
): string {
  const seconds = CATALOG_INTERACTIVE_COMMAND_TIMEOUT_MS / 1_000;
  return CATALOG_INTERACTIVE_WRITE_COMMANDS.has(commandType)
    ? `保存本地 Markdown 超过 ${seconds} 秒仍未完成。保存结果尚未确认，请检查文件后重试。`
    : `读取本地目录超过 ${seconds} 秒仍未完成，请检查项目所在磁盘后重试。`;
}
