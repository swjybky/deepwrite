import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BookTemplateDraftSchema,
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope
} from "@deepwrite/contracts";
import { BookTemplateStore } from "../book-template-store";
import type { IpcCommandContext } from "./command-types";
import { handleBookTemplateCommands } from "./book-template-commands";
import {
  createNewShortBook,
  createNewScriptBook
} from "../../utilities/folder-catalog-store/book-creation";
vi.mock("electron", () => ({ app: { getPath: vi.fn() } }));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-template-ipc-"));
  roots.push(root);
  const store = new BookTemplateStore(root);
  const requestCommand = vi.fn(
    async (_worker: string, command: CommandEnvelope) => {
      if (
        command.type !== "catalog.createShortBookAtPath" &&
        command.type !== "catalog.createScriptBookAtPath"
      )
        throw new Error("Unexpected command");
      const payload =
        command.type === "catalog.createShortBookAtPath"
          ? createNewShortBook(
              command.payload.input,
              "2026-01-01T00:00:00.000Z"
            )
          : createNewScriptBook(
              command.payload.input,
              "2026-01-01T00:00:00.000Z"
            );
      return { status: "accepted", requestId: command.id, payload };
    }
  );
  const requireSelectedWorkspaceDirectory = vi.fn(
    async (): Promise<string | null> => join(root, "workspace")
  );
  const ctx = {
    requireSelectedWorkspaceDirectory,
    workspaceResourceParent: (directory: string) => join(directory, "books"),
    supervisor: { requestCommand }
  } as unknown as IpcCommandContext;
  const configuration = BookTemplateDraftSchema.parse({
    name: "创建模板",
    workspaceType: "short",
    genre: "其他",
    characterFormat: "list",
    defaultPlotStageIds: ["outline"],
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: {
      general: [],
      plot: [],
      style: ["skill_test"],
      other: []
    }
  });
  return {
    store,
    ctx,
    configuration,
    requestCommand,
    requireSelectedWorkspaceDirectory
  };
}
function command(templateId: string) {
  return CommandEnvelopeSchema.parse(
    createEnvelope(
      "catalog.createBookFromTemplate",
      { templateId, title: "新作品" },
      { id: "cmd_template_test" }
    )
  );
}
describe("book template IPC routing", () => {
  it("keeps a template's team choice out of the Core creation command", async () => {
    const h = await setup();
    const saved = await h.store.save({
      configuration: { ...h.configuration, linkedAgentTeamIds: ["team-a"] }
    });

    const result = await handleBookTemplateCommands(
      h.ctx,
      command(saved.id),
      () => h.store
    );

    expect(result).toMatchObject({ status: "accepted" });
    expect(saved.configuration.linkedAgentTeamIds).toEqual(["team-a"]);
    expect((await h.store.list())[0]?.configuration.linkedAgentTeamIds).toEqual(
      ["team-a"]
    );
    expect(JSON.stringify(h.requestCommand.mock.calls[0]?.[1])).not.toContain(
      "linkedAgentTeamIds"
    );
  });

  it("omits the team field from templates that bind no team", async () => {
    const h = await setup();

    const saved = await h.store.save({ configuration: h.configuration });

    expect(saved.configuration).not.toHaveProperty("linkedAgentTeamIds");
  });

  it.each(["short", "script"] as const)(
    "resolves saved %s configuration in Main and forwards it through the existing authorized path",
    async (workspaceType) => {
      const h = await setup();
      const saved = await h.store.save({
        configuration: { ...h.configuration, workspaceType }
      });
      const result = await handleBookTemplateCommands(
        h.ctx,
        command(saved.id),
        () => h.store
      );
      expect(result).toMatchObject({
        status: "accepted",
        requestId: "cmd_template_test",
        payload: {
          title: "新作品",
          bookType: workspaceType,
          characterStructure: { format: "list", items: [] }
        }
      });
      expect(h.requestCommand.mock.calls[0]?.[1]).toMatchObject({
        type:
          workspaceType === "short"
            ? "catalog.createShortBookAtPath"
            : "catalog.createScriptBookAtPath",
        payload: {
          input: {
            title: "新作品",
            characterFormat: "list",
            defaultPlotStageIds: ["outline"],
            linkedSkillIdsByKind: { style: ["skill_test"] }
          }
        }
      });
      expect(h.requestCommand.mock.calls[0]?.[1].payload).not.toHaveProperty(
        "templateId"
      );
    }
  );
  it("does not call Core for deleted templates or when workspace selection is canceled", async () => {
    const h = await setup();
    const saved = await h.store.save({ configuration: h.configuration });
    h.requireSelectedWorkspaceDirectory.mockResolvedValueOnce(null);
    expect(
      await handleBookTemplateCommands(h.ctx, command(saved.id), () => h.store)
    ).toMatchObject({ status: "accepted", payload: null });
    await h.store.delete(saved.id);
    expect(
      await handleBookTemplateCommands(h.ctx, command(saved.id), () => h.store)
    ).toMatchObject({
      status: "rejected",
      error: { message: "模板已删除，请重新选择模板。" }
    });
    expect(h.requestCommand).not.toHaveBeenCalled();
  });
});
