import { basename } from "node:path";
import {
  ImportLibraryPackageResultSchema,
  LibraryPackageExportSourceSchema,
  PreviewLibraryPackageAtPathResultSchema,
  previewLibraryPackage,
  recognizeLibraryPackage,
  resolveLibraryPackageImport,
  type CommandEnvelope
} from "@deepwrite/contracts";
import type { UtilityRuntimeOptions } from "../runtime";
import type { FolderCatalogStore } from "../folder-catalog-store";
import { scanLibraryPackageSource } from "./scan-source";

type Handler = NonNullable<UtilityRuntimeOptions["commandHandler"]>;
type Command<Type extends CommandEnvelope["type"]> = Extract<
  CommandEnvelope,
  { type: Type }
>;

class SourceChangedError extends Error {}

async function run(
  requireCatalog: () => Promise<FolderCatalogStore>,
  command: CommandEnvelope
): Promise<unknown> {
  switch (command.type) {
    case "catalog.readLibraryPackageSource":
      return LibraryPackageExportSourceSchema.parse(
        await (await requireCatalog()).readLibraryPackageSource(command.payload)
      );
    case "catalog.previewLibraryPackageAtPath": {
      const { sourcePath, sourceKind, domain } = (
        command as Command<"catalog.previewLibraryPackageAtPath">
      ).payload;
      const scanned = await scanLibraryPackageSource(sourcePath, sourceKind);
      const plan = recognizeLibraryPackage(scanned.tree, domain);
      return PreviewLibraryPackageAtPathResultSchema.parse({
        preview: previewLibraryPackage(plan, {
          sourceName: basename(sourcePath),
          sourceKind
        }),
        sourceFingerprint: scanned.fingerprint
      });
    }
    case "catalog.importLibraryPackageAtPath": {
      const input = (command as Command<"catalog.importLibraryPackageAtPath">)
        .payload;
      const scanned = await scanLibraryPackageSource(
        input.sourcePath,
        input.sourceKind
      );
      if (scanned.fingerprint !== input.expectedFingerprint) {
        throw new SourceChangedError("来源在识别后发生了变化，请重新选择。");
      }
      const resolved = resolveLibraryPackageImport(
        recognizeLibraryPackage(scanned.tree, input.domain),
        input.choices
      );
      return ImportLibraryPackageResultSchema.parse(
        await (
          await requireCatalog()
        ).importLibraryPackage(resolved, input.parents)
      );
    }
    default:
      return undefined;
  }
}

/** Core side of 素材包/技能包 export and import; Main supplies every path. */
export function withLibraryPackageCommands(
  requireCatalog: () => Promise<FolderCatalogStore>,
  handler: Handler
): Handler {
  return async (command, emitEvent, context) => {
    if (
      command.type !== "catalog.readLibraryPackageSource" &&
      command.type !== "catalog.previewLibraryPackageAtPath" &&
      command.type !== "catalog.importLibraryPackageAtPath"
    ) {
      return handler(command, emitEvent, context);
    }
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: await run(requireCatalog, command)
      };
    } catch (error) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code:
            error instanceof SourceChangedError
              ? "catalog.package_source_changed"
              : "catalog.library_package_failed",
          message: error instanceof Error ? error.message : "素材包操作失败。"
        }
      };
    }
  };
}
