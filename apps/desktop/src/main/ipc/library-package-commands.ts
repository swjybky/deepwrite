import type { BrowserWindow, Dialog } from "electron";
import {
  ChooseLibraryPackageSourceResultSchema,
  CommandEnvelopeSchema,
  DiscardLibraryPackagePreviewResultSchema,
  ImportLibraryPackageResultSchema,
  PreviewLibraryPackageAtPathResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type LibraryPackageDomain,
  type LibraryPackageSourceKind
} from "@deepwrite/contracts";
import type { UtilitySupervisor } from "../supervisor";
import type {
  ImportPreviewRegistry,
  ImportPreviewSource
} from "../import-preview-registry";
import { exportLibraryPackage } from "../library-package-export";
import { nativeText } from "../native-i18n";
import { safeErrorDetails } from "./errors";
import {
  workspaceGroupParent,
  workspaceResourceParent
} from "./workspace-paths";

export interface LibraryPackagePreviewSource extends ImportPreviewSource {
  sourceKind: LibraryPackageSourceKind;
  domain: LibraryPackageDomain;
}

export interface LibraryPackageCommandContext {
  supervisor: Pick<UtilitySupervisor, "requestCommand">;
  window: BrowserWindow;
  dialog: Pick<Dialog, "showOpenDialog">;
  documentsPath: string;
  appVersion: string;
  webContentsId: number;
  previews: ImportPreviewRegistry<LibraryPackagePreviewSource>;
  requireSelectedWorkspaceDirectory(): Promise<string | null>;
}

class CoreRejection extends Error {
  constructor(readonly result: Extract<CommandResult, { status: "rejected" }>) {
    super(result.error.message);
  }
}

const PUBLIC_TYPES = new Set<string>([
  "catalog.exportLibraryPackage",
  "catalog.chooseLibraryPackageSource",
  "catalog.importLibraryPackage",
  "catalog.discardLibraryPackagePreview"
]);

async function run(
  ctx: LibraryPackageCommandContext,
  command: CommandEnvelope
): Promise<unknown> {
  const core = async (type: CommandEnvelope["type"], payload: unknown) => {
    const result = await ctx.supervisor.requestCommand(
      "core",
      CommandEnvelopeSchema.parse(
        createEnvelope(type, payload, {
          id: `${command.id}-core`,
          context: command.context
        })
      ),
      0
    );
    if (result.status === "rejected") throw new CoreRejection(result);
    return result.payload;
  };

  switch (command.type) {
    case "catalog.exportLibraryPackage":
      return await exportLibraryPackage({
        window: ctx.window,
        dialog: ctx.dialog,
        defaultPath: ctx.documentsPath,
        appVersion: ctx.appVersion,
        readSource: () =>
          core("catalog.readLibraryPackageSource", command.payload)
      });
    case "catalog.chooseLibraryPackageSource": {
      const { domain, sourceKind } = command.payload;
      const selection = await ctx.dialog.showOpenDialog(ctx.window, {
        defaultPath: ctx.documentsPath,
        buttonLabel: nativeText("recognize"),
        ...(sourceKind === "zip"
          ? {
              title: nativeText("chooseLibraryPackage"),
              properties: ["openFile"],
              filters: [{ name: nativeText("zipArchive"), extensions: ["zip"] }]
            }
          : {
              title: nativeText("chooseImportFolder"),
              properties: ["openDirectory"]
            })
      });
      const sourcePath = selection.filePaths[0];
      if (selection.canceled || !sourcePath) return null;
      const scanned = PreviewLibraryPackageAtPathResultSchema.parse(
        await core("catalog.previewLibraryPackageAtPath", {
          sourcePath,
          sourceKind,
          domain
        })
      );
      const { previewId, expiresAt } = ctx.previews.register({
        webContentsId: ctx.webContentsId,
        sourcePath,
        sourceFingerprint: scanned.sourceFingerprint,
        sourceKind,
        domain: scanned.preview.domain
      });
      return ChooseLibraryPackageSourceResultSchema.parse({
        previewId,
        expiresAt: new Date(expiresAt).toISOString(),
        preview: scanned.preview
      });
    }
    case "catalog.importLibraryPackage": {
      const { previewId, choices } = command.payload;
      const source = ctx.previews.resolve(previewId, ctx.webContentsId);
      const workspace = await ctx.requireSelectedWorkspaceDirectory();
      if (!workspace) throw new Error("请先选择 DeepWrite 工作目录。");
      const result = ImportLibraryPackageResultSchema.parse(
        await core("catalog.importLibraryPackageAtPath", {
          sourcePath: source.sourcePath,
          sourceKind: source.sourceKind,
          domain: source.domain,
          expectedFingerprint: source.sourceFingerprint,
          choices,
          parents: {
            library: workspaceResourceParent(workspace, source.domain),
            group: workspaceGroupParent(workspace, source.domain)
          }
        })
      );
      ctx.previews.consume(previewId);
      return result;
    }
    case "catalog.discardLibraryPackagePreview": {
      let discarded = false;
      try {
        ctx.previews.resolve(command.payload.previewId, ctx.webContentsId);
        discarded = ctx.previews.consume(command.payload.previewId);
      } catch {
        // Already expired or owned by another window: nothing to release.
      }
      return DiscardLibraryPackagePreviewResultSchema.parse({ discarded });
    }
    default:
      return undefined;
  }
}

/** Renderer → Main for 素材包/技能包; source paths never leave Main. */
export async function handleLibraryPackageCommands(
  ctx: LibraryPackageCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (!PUBLIC_TYPES.has(command.type)) return undefined;
  try {
    return {
      status: "accepted",
      requestId: command.id,
      payload: await run(ctx, command)
    };
  } catch (error: unknown) {
    if (error instanceof CoreRejection) {
      return { ...error.result, requestId: command.id };
    }
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "catalog.library_package_failed",
        message: error instanceof Error ? error.message : "素材包操作失败。",
        details: safeErrorDetails(error)
      }
    };
  }
}
