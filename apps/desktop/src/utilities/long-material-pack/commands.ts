import {
  createEnvelope,
  LongMaterialConvertResultSchema,
  LongMaterialGuideEvidenceSchema,
  LongMaterialPreviewSchema,
  LongMaterialProgressEventEnvelopeSchema,
  LongMaterialSourceStatsSchema,
  type CommandEnvelope,
  type LongMaterialCoreInput
} from "@deepwrite/contracts";
import type { UtilityRuntimeOptions } from "../runtime";
import type { FolderCatalogStore } from "../folder-catalog-store";
import type { LongWorkspaceService } from "../long-workspace-service";
import { inspectLongMaterialSource } from "./inspect";
import { buildGuideEvidence } from "./evidence";
import { previewLongMaterial } from "./preview";
import { readLongMaterialSource } from "./source-reader";
import { LongMaterialPackService } from "./service";

type Handler = NonNullable<UtilityRuntimeOptions["commandHandler"]>;

/** Core side of 长篇转素材库: the only writer of its records and entries. */
export function withLongMaterialPackCommands(
  requireCatalog: () => Promise<FolderCatalogStore>,
  longs: LongWorkspaceService,
  handler: Handler
): Handler {
  // One conversion per pack or book at a time; others wait their turn.
  let tail: Promise<unknown> = Promise.resolve();
  return async (command, emitEvent, context) => {
    if (command.type !== "longMaterialPack.core")
      return handler(command, emitEvent, context);
    const { workspaceDirectory, paths, request } = (
      command as Extract<CommandEnvelope, { type: "longMaterialPack.core" }>
    ).payload as LongMaterialCoreInput;
    const service = new LongMaterialPackService({
      workspaceDirectory,
      paths,
      longs,
      catalog: await requireCatalog(),
      ...(request.operation === "convert"
        ? {
            progress: (payload) =>
              emitEvent(
                LongMaterialProgressEventEnvelopeSchema.parse(
                  createEnvelope(
                    "long_material_pack.progress",
                    { operationId: request.operationId, ...payload },
                    { id: `${command.id}-progress`, context: command.context }
                  )
                )
              )
          }
        : {})
    });
    const run = async (): Promise<unknown> => {
      switch (request.operation) {
        case "inspect":
          return LongMaterialSourceStatsSchema.parse(
            await inspectLongMaterialSource(
              service,
              longs,
              workspaceDirectory,
              request.bookId
            )
          );
        case "list":
          return service.summaries(request.bookId);
        case "deleteRecord":
          await service.store.remove(request.packId);
          return null;
        case "preview":
          return LongMaterialPreviewSchema.parse(
            await previewLongMaterial(service, request)
          );
        case "convert":
          return LongMaterialConvertResultSchema.parse(
            await service.convert(request)
          );
        case "resolve": {
          const record = await service.store.read(request.packId);
          const pick = (action: string) =>
            new Set(
              request.decisions
                .filter((d) => d.action === action)
                .map(({ key }) => key)
            );
          return LongMaterialConvertResultSchema.parse(
            await service.convert(
              {
                bookId: record.bookId,
                options: record.options,
                target: { action: "update", packId: record.id },
                operationId: `resolve:${record.id}`
              },
              {
                decisions: {
                  overwrite: pick("overwrite"),
                  remove: pick("remove"),
                  regenerate: pick("regenerate")
                }
              }
            )
          );
        }
        case "applyGuide": {
          const record = await service.store.read(request.packId);
          return LongMaterialConvertResultSchema.parse(
            await service.convert(
              {
                bookId: record.bookId,
                options: record.options,
                target: { action: "update", packId: record.id },
                operationId: `guide:${record.id}`
              },
              {
                guide: {
                  submission: request.submission,
                  ...(request.modelLabel
                    ? { modelLabel: request.modelLabel }
                    : {})
                }
              }
            )
          );
        }
        case "evidence": {
          const record = await service.store.read(request.packId);
          const opening = (
            await inspectLongMaterialSource(
              service,
              longs,
              workspaceDirectory,
              record.bookId
            )
          ).chapters
            .slice(0, 3)
            .map(({ id }) => id);
          const samples = [
            ...new Set([...opening, ...record.options.sampleChapterIds])
          ].slice(0, 8);
          const source = await readLongMaterialSource(
            longs,
            workspaceDirectory,
            record.bookId,
            samples
          );
          return LongMaterialGuideEvidenceSchema.parse(
            buildGuideEvidence(source, request.evidenceTokens)
          );
        }
      }
    };
    const writes = [
      "convert",
      "resolve",
      "applyGuide",
      "deleteRecord"
    ].includes(request.operation);
    try {
      const task = writes ? tail.catch(() => undefined).then(run) : run();
      if (writes) tail = task;
      return { status: "accepted", requestId: command.id, payload: await task };
    } catch (error) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long_material_pack.failed",
          message:
            error instanceof Error ? error.message : "长篇转素材库操作失败。"
        }
      };
    }
  };
}
