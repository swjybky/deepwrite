import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope
} from "@deepwrite/contracts";
import { handleWebSearchCommands } from "./web-search-commands";
import { SafeWebSearchError } from "./web-search-errors";
import {
  SEARCH_KEY,
  deepSeekModel,
  settingsInput,
  setup
} from "./web-search-test-support";

function command(type: string, payload: unknown): CommandEnvelope {
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, { id: "cmd_web_search" })
  );
}

describe("handleWebSearchCommands", () => {
  it("ignores commands of other domains", async () => {
    const { service } = await setup();
    expect(
      await handleWebSearchCommands(command("system.health", {}), service)
    ).toBeUndefined();
  });

  it("serves every command with a validated payload", async () => {
    const { service } = await setup({
      models: [deepSeekModel("m_chat", SEARCH_KEY)],
      tester: async () => ({
        resultCount: 1,
        samples: [{ title: "结果", url: "https://example.test/a" }]
      })
    });
    const run = async (type: string, payload: unknown) =>
      handleWebSearchCommands(command(type, payload), service);

    expect(await run("webSearch.getSettings", {})).toMatchObject({
      status: "accepted",
      payload: { enabled: true }
    });
    expect(
      await run("webSearch.saveSettings", settingsInput({ enabled: false }))
    ).toMatchObject({ status: "accepted", payload: { enabled: false } });
    expect(await run("webSearch.setEnabled", { enabled: true })).toMatchObject({
      status: "accepted",
      payload: { enabled: true }
    });
    expect(
      await run("webSearch.listKeyImportCandidates", { providerId: "deepseek" })
    ).toMatchObject({
      status: "accepted",
      payload: { candidates: [{ sourceModelId: "m_chat" }] }
    });
    expect(
      await run("webSearch.importKey", {
        providerId: "deepseek",
        sourceModelId: "m_chat"
      })
    ).toMatchObject({
      status: "accepted",
      payload: {
        profiles: expect.arrayContaining([
          expect.objectContaining({ providerId: "deepseek", hasApiKey: true })
        ])
      }
    });
    expect(
      await run("webSearch.test", { providerId: "deepseek" })
    ).toMatchObject({ status: "accepted", payload: { resultCount: 1 } });
  });

  it("returns safe messages and hides unexpected error details", async () => {
    const { service } = await setup({
      tester: async () => {
        throw new Error(`https://search.example.test/?key=${SEARCH_KEY}`);
      }
    });
    const unsafe = await handleWebSearchCommands(
      command("webSearch.test", { providerId: "deepseek", apiKey: SEARCH_KEY }),
      service
    );
    expect(unsafe).toEqual({
      status: "rejected",
      requestId: "cmd_web_search",
      error: {
        code: "web_search.operation_failed",
        message: "联网搜索操作失败，请检查配置或稍后重试。"
      }
    });

    const safe = await setup({
      tester: async () => {
        throw new SafeWebSearchError("联网搜索 API Key 无效。");
      }
    });
    const result = await handleWebSearchCommands(
      command("webSearch.test", { providerId: "deepseek", apiKey: SEARCH_KEY }),
      safe.service
    );
    expect(result).toMatchObject({
      status: "rejected",
      error: { message: "联网搜索 API Key 无效。" }
    });
    expect(JSON.stringify([unsafe, result])).not.toContain(SEARCH_KEY);
  });
});
