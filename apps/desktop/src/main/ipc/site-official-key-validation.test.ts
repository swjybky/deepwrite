import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type ModelSettings
} from "@deepwrite/contracts";
import {
  listRemoteModels,
  type ListRemoteModelsInput
} from "../list-remote-models";
import {
  handleModelCommands,
  type ModelCommandContext
} from "./model-commands";
import { siteOfficialOperationState } from "./site-official-operation";

vi.mock("../deepwrite-public-data-config", () => ({
  DEEPWRITE_PUBLIC_DATA_API_BASE_URL: "https://gateway.example.test"
}));

const replacementKey = "replacement_test_only_invalid";
const current: ModelSettings = {
  models: [
    {
      id: "deepwrite-site-official-writer-test",
      label: "Writer Test",
      provider: "deepwrite-site",
      modelId: "writer-test",
      api: "openai-completions",
      baseUrl: "https://gateway.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "high"],
      temperatureOptions: [0.1, 0.7, 1],
      hasApiKey: true
    }
  ],
  defaultModelId: "deepwrite-site-official-writer-test"
};

function setup(status: number, remaining: number | null) {
  const remoteFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    expect(
      headers.get("x-goog-api-key") ??
        headers.get("Authorization")?.replace(/^Bearer /u, "")
    ).toBe(replacementKey);
    if (url.includes("/key/quota")) {
      return remaining === null
        ? Response.json({ error: { code: "invalid_api_key" } }, { status: 401 })
        : Response.json({
            object: "api_key_quota",
            unlimited: false,
            remaining,
            used: 10 - remaining,
            total: 10
          });
    }
    if (url.includes("/v1beta/models")) {
      return Response.json({ error: { code: "invalid_api_key" } }, { status });
    }
    return Response.json({ data: [{ id: "writer-test" }] });
  });
  const store = {
    list: vi.fn(async () => current),
    save: vi.fn(async () => current),
    resolveDraftApiKey: vi.fn(async () => "previous_test_only_invalid")
  };
  const syncConfiguredModels = vi.fn(async () => undefined);
  const ctx = {
    requireModelConfigStore: () => store,
    requireModelUsageStore: () => ({ syncConfiguredModels }),
    listRemoteModels: (input: ListRemoteModelsInput) =>
      listRemoteModels(input, remoteFetch),
    remoteFetch
  } as unknown as ModelCommandContext;
  const command = CommandEnvelopeSchema.parse(
    createEnvelope(
      "models.saveSiteOfficialToken",
      { apiKey: replacementKey },
      { id: "cmd_replace_site_key" }
    )
  );
  return { ctx, command, remoteFetch, store, syncConfiguredModels };
}

describe("new-site replacement key validation", () => {
  it("distinguishes an exhausted key from invalid credentials without saving it", async () => {
    const { ctx, command, store, remoteFetch, syncConfiguredModels } = setup(
      401,
      0
    );
    const result = await handleModelCommands(ctx, command);
    expect(result).toMatchObject({
      status: "rejected",
      error: { message: expect.stringContaining("额度已用完") }
    });
    expect(store.save).not.toHaveBeenCalled();
    expect(store.resolveDraftApiKey).not.toHaveBeenCalled();
    expect(syncConfiguredModels).not.toHaveBeenCalled();
    expect(remoteFetch).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain(replacementKey);
  });

  it("identifies the rejected endpoint when quota authentication succeeds", async () => {
    const { ctx, command, store } = setup(403, 5);
    const result = await handleModelCommands(ctx, command);
    expect(result).toMatchObject({
      status: "rejected",
      error: {
        message: expect.stringContaining("/v1beta/models：HTTP 403")
      }
    });
    expect(result?.status === "rejected" && result.error.message).toContain(
      "密钥额度查询成功"
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it("retains the model authentication failure when quota cannot be queried", async () => {
    const { ctx, command } = setup(401, null);
    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "rejected",
      error: {
        message: expect.stringContaining("/v1beta/models：HTTP 401")
      }
    });
  });

  it("does not diagnose network failures as invalid keys", async () => {
    const { ctx, command, remoteFetch } = setup(503, null);
    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "rejected",
      error: {
        message: expect.stringContaining("/v1beta/models：HTTP 503")
      }
    });
    expect(remoteFetch).toHaveBeenCalledTimes(2);
  });

  it("does not expose an untrusted failure containing the replacement key", async () => {
    const { ctx, command, store } = setup(503, null);
    ctx.listRemoteModels = vi.fn(async () => {
      throw new Error(`request failed with ${replacementKey}`);
    });
    const result = await handleModelCommands(ctx, command);
    expect(result).toMatchObject({ status: "rejected" });
    expect(JSON.stringify(result)).not.toContain(replacementKey);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("holds the key operation lock until both catalog requests finish", async () => {
    const { ctx, command, store } = setup(503, null);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.listRemoteModels = vi.fn(async (input) => {
      if (input.api === "google-generative-ai") await pending;
      else throw new Error("catalog unavailable");
      return [];
    });
    const saving = handleModelCommands(ctx, command);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(siteOfficialOperationState(store).busy).toBe(true);
    } finally {
      release();
      await saving;
    }
    expect(siteOfficialOperationState(store).busy).toBe(false);
    expect(store.save).not.toHaveBeenCalled();
  });
});
