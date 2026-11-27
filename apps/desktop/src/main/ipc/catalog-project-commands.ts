import { nativeText } from "../native-i18n";
import {
  AcademicBookSchema,
  CatalogLibrarySchema,
  CatalogLibraryGroupSchema,
  CatalogOpenProjectResultSchema,
  DuplicateCatalogProjectResultSchema,
  ShortBookSchema,
  ScriptBookSchema,
  CommandEnvelopeSchema,
  createEnvelope,
  isBuiltinCatalogProjectId,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";
import { rejectedResult } from "./errors";

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
    command.type === "catalog.duplicateProject" &&
    isBuiltinCatalogProjectId(command.payload.projectId)
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
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope(
          "catalog.duplicateProjectAtPath",
          {
            domain: command.payload.domain,
            projectId: command.payload.projectId,
            targetParents: {
              materialLibrary: ctx.workspaceResourceParent(
                workspaceDirectory,
                "material"
              ),
              materialGroup: ctx.workspaceGroupParent(
                workspaceDirectory,
                "material"
              ),
              skillLibrary: ctx.workspaceResourceParent(
                workspaceDirectory,
                "skill"
              ),
              skillGroup: ctx.workspaceGroupParent(workspaceDirectory, "skill")
            }
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
      return {
        status: "accepted",
        requestId: command.id,
        payload: DuplicateCatalogProjectResultSchema.parse(result.payload)
      };
    } catch (error: unknown) {
      return rejectedResult(
        command.id,
        "catalog.forward_failed",
        error instanceof Error ? error.message : "复制内置资料库失败。",
        safeErrorDetails(error)
      );
    }
  }
  if (
    command.type === "catalog.createShortBook" ||
    command.type === "catalog.createScriptBook" ||
    command.type === "catalog.createAcademicBook" ||
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
        command.type === "catalog.createScriptBook" ||
        command.type === "catalog.createAcademicBook"
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
        command.type === "catalog.createAcademicBook" ||
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
            : command.type === "catalog.createAcademicBook"
              ? createEnvelope(
                  "catalog.createAcademicBookAtPath",
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
            : command.type === "catalog.createAcademicBook"
              ? AcademicBookSchema.parse(result.payload)
              : command.type === "catalog.createLibrary"
                ? CatalogLibrarySchema.parse(result.payload)
                : command.type === "catalog.createLibraryGroup"
                  ? CatalogLibraryGroupSchema.parse(result.payload)
                  : CatalogOpenProjectResultSchema.parse(result.payload);
      return { status: "accepted", requestId: command.id, payload };
    } catch (error: unknown) {
      return rejectedResult(
        command.id,
        "catalog.forward_failed",
        error instanceof Error ? error.message : "目录操作失败。",
        safeErrorDetails(error)
      );
    }
  }
  return undefined;
}
