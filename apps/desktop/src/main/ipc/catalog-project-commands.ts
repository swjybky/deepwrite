import { nativeText } from "../native-i18n";
import {
  CatalogLibrarySchema,
  CatalogLibraryGroupSchema,
  CatalogOpenProjectResultSchema,
  ShortBookSchema,
  ScriptBookSchema,
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

export type CatalogProjectCommandContext = Pick<
  IpcCommandContext,
  | "requireSelectedWorkspaceDirectory"
  | "workspaceGroupParent"
  | "workspaceResourceParent"
  | "dialog"
  | "supervisor"
>;

export async function handleCatalogProjectCommands(
  ctx: CatalogProjectCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (
    command.type === "catalog.createShortBook" ||
    command.type === "catalog.createScriptBook" ||
    command.type === "catalog.createLibrary" ||
    command.type === "catalog.createLibraryGroup" ||
    command.type === "catalog.openProject"
  ) {
    try {
      const workspaceDirectory = await ctx.requireSelectedWorkspaceDirectory();
      if (!workspaceDirectory) {
        return {
          status: "accepted",
          requestId: command.id,
          payload: null
        };
      }

      const domain =
        command.type === "catalog.createShortBook" ||
        command.type === "catalog.createScriptBook"
          ? "book"
          : command.payload.domain;
      const defaultPath =
        command.type === "catalog.createLibraryGroup"
          ? ctx.workspaceGroupParent(workspaceDirectory, command.payload.domain)
          : ctx.workspaceResourceParent(workspaceDirectory, domain);
      let selectedPaths: string[];
      if (
        command.type === "catalog.createShortBook" ||
        command.type === "catalog.createScriptBook" ||
        command.type === "catalog.createLibrary" ||
        command.type === "catalog.createLibraryGroup"
      ) {
        selectedPaths = [defaultPath];
      } else {
        const selection = await ctx.dialog.showOpenDialog({
          title:
            domain === "book"
              ? nativeText("openBook")
              : domain === "material"
                ? nativeText("openMaterials")
                : nativeText("openSkills"),
          defaultPath,
          properties: ["openDirectory"]
        });
        if (selection.canceled || selection.filePaths.length === 0) {
          return {
            status: "accepted",
            requestId: command.id,
            payload: null
          };
        }
        selectedPaths = selection.filePaths;
      }

      const selectedPath = selectedPaths[0]!;

      const internalCommand = CommandEnvelopeSchema.parse(
        command.type === "catalog.createShortBook"
          ? createEnvelope(
              "catalog.createShortBookAtPath",
              {
                parentDirectory: selectedPath,
                input: command.payload
              },
              { id: command.id, context: command.context }
            )
          : command.type === "catalog.createScriptBook"
            ? createEnvelope(
                "catalog.createScriptBookAtPath",
                {
                  parentDirectory: selectedPath,
                  input: command.payload
                },
                { id: command.id, context: command.context }
              )
            : command.type === "catalog.createLibrary"
              ? createEnvelope(
                  "catalog.createLibraryAtPath",
                  {
                    ...command.payload,
                    parentDirectory: selectedPath
                  },
                  { id: command.id, context: command.context }
                )
              : command.type === "catalog.createLibraryGroup"
                ? createEnvelope(
                    "catalog.createLibraryGroupAtPath",
                    {
                      parentDirectory: selectedPath,
                      input: command.payload
                    },
                    { id: command.id, context: command.context }
                  )
                : createEnvelope(
                    "catalog.openProjectAtPath",
                    {
                      projectDirectory: selectedPath,
                      domain: command.payload.domain
                    },
                    { id: command.id, context: command.context }
                  )
      );

      const result = await ctx.supervisor.requestCommand(
        "core",
        internalCommand,
        0
      );
      if (result.status === "rejected") {
        return result;
      }
      const payload =
        command.type === "catalog.createShortBook"
          ? ShortBookSchema.parse(result.payload)
          : command.type === "catalog.createScriptBook"
            ? ScriptBookSchema.parse(result.payload)
            : command.type === "catalog.createLibrary"
              ? CatalogLibrarySchema.parse(result.payload)
              : command.type === "catalog.createLibraryGroup"
                ? CatalogLibraryGroupSchema.parse(result.payload)
                : CatalogOpenProjectResultSchema.parse(result.payload);
      return { status: "accepted", requestId: command.id, payload };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "catalog.forward_failed",
          message: error instanceof Error ? error.message : "目录操作失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }
}
