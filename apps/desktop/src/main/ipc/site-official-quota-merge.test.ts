import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type ModelSettings,
  type CommandEnvelope
} from "@deepwrite/contracts";
import {
  handleModelCommands,
  type ModelCommandContext
} from "./model-commands";

vi.mock("../deepwrite-site-official-model-config", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../deepwrite-site-official-model-config")
    >();
  return {
    ...original,
    deepWriteSiteOfficialGatewayBaseUrl: () => "https://gateway.example.test/v1"
  };
});

const target = "target_test_only_invalid";
const source = "source_test_only_invalid";
const settings: ModelSettings = { defaultModelId: "", models: [] };
const quota = {
  object: "api_key_quota",
  currency: "CNY",
  queried_at: "2026-09-09T00:00:00Z",
  status: "exhausted",
  unlimited: false,
  total: "10",
  used: "10",
  remaining: "0"
};
function command(type: string, payload = {}): CommandEnvelope {
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, { id: "cmd_quota_test" })
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const store = {
    list: vi.fn(async () => ({
      ...settings,
      models: [
        {
          id: "deepwrite-site-official-test",
          hasApiKey: true
        }
      ]
    })),
    resolveDraftApiKey: vi.fn(async () => target),
    save: vi.fn(async () => settings)
  };
  const remoteFetch = vi.fn(
    async (_input: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === "POST"
            ? {
                object: "api_key_quota_merge",
                currency: "CNY",
                transferred: "3",
                source_revoked: true,
                quota: {
                  ...quota,
                  status: "active",
                  remaining: "3",
                  total: "13"
                }
              }
            : quota
        )
      )
  );
  const ctx = {
    requireModelConfigStore: () => store,
    remoteFetch,
    requireModelUsageStore: () => ({
      syncConfiguredModels: vi.fn(async () => undefined)
    }),
    listRemoteModels: vi.fn(async () => [])
  } as unknown as ModelCommandContext;
  return { ctx, store, remoteFetch };
}
async function revision(ctx: ModelCommandContext) {
  const result = await handleModelCommands(
    ctx,
    command("models.querySiteOfficialQuota")
  );
  expect(result?.status).toBe("accepted");
  return (result as { payload: { targetRevision: string } }).payload
    .targetRevision;
}

describe("quota merge IPC", () => {
  it("merges into an exhausted saved key, returns only public quota, and never saves the source", async () => {
    const { ctx, store, remoteFetch } = setup();
    const targetRevision = await revision(ctx);
    const result = await handleModelCommands(
      ctx,
      command("models.mergeSiteOfficialQuota", {
        sourceKey: source,
        targetRevision
      })
    );
    expect(result).toMatchObject({
      status: "accepted",
      payload: {
        transferred: "3",
        sourceRevoked: true,
        quota: { remaining: 3, targetRevision }
      }
    });
    expect(remoteFetch).toHaveBeenLastCalledWith(
      "https://gateway.example.test/v1/key/quota/merge",
      expect.objectContaining({
        body: JSON.stringify({ source_key: source }),
        headers: expect.objectContaining({ Authorization: `Bearer ${target}` })
      })
    );
    expect(store.save).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(source);
    expect(JSON.stringify(result)).not.toContain(target);
  });

  it("rejects stale target confirmation after a generic model save", async () => {
    const { ctx, remoteFetch } = setup();
    const targetRevision = await revision(ctx);
    await handleModelCommands(ctx, command("models.save", settings));
    const result = await handleModelCommands(
      ctx,
      command("models.mergeSiteOfficialQuota", {
        sourceKey: source,
        targetRevision
      })
    );
    expect(result).toMatchObject({
      status: "rejected",
      error: { code: "target_changed" }
    });
    expect(remoteFetch).toHaveBeenCalledOnce();
  });

  it("locks all target changes and duplicate merges until the request settles", async () => {
    const { ctx, remoteFetch, store } = setup();
    const targetRevision = await revision(ctx);
    const blocked = deferred<Response>();
    remoteFetch.mockImplementationOnce(() => blocked.promise);
    const merge = command("models.mergeSiteOfficialQuota", {
      sourceKey: source,
      targetRevision
    });
    const pending = handleModelCommands(ctx, merge);
    for (const mutation of [
      merge,
      command("models.save", settings),
      command("models.clearSiteOfficialToken"),
      command("models.saveSiteOfficialToken", {
        apiKey: "replacement_test_only_invalid"
      }),
      command("models.refreshSiteOfficial")
    ]) {
      expect(await handleModelCommands(ctx, mutation)).toMatchObject({
        status: "rejected",
        error: { code: "models_busy" }
      });
    }
    expect(store.save).not.toHaveBeenCalled();
    blocked.resolve(
      new Response(
        JSON.stringify({ error: { code: "key_in_use", message: source } }),
        { status: 409 }
      )
    );
    expect(await pending).toMatchObject({
      status: "rejected",
      error: { code: "key_in_use" }
    });
    expect(
      await handleModelCommands(ctx, command("models.save", settings))
    ).toMatchObject({ status: "accepted" });
  });

  it("discards a quota query that finishes after the target is replaced", async () => {
    const { ctx, remoteFetch } = setup();
    const blocked = deferred<Response>();
    remoteFetch.mockImplementationOnce(() => blocked.promise);
    const pending = handleModelCommands(
      ctx,
      command("models.querySiteOfficialQuota")
    );
    await vi.waitFor(() => expect(remoteFetch).toHaveBeenCalledOnce());
    await handleModelCommands(ctx, command("models.save", settings));
    blocked.resolve(new Response(JSON.stringify(quota)));
    expect(await pending).toMatchObject({
      status: "rejected",
      error: { message: expect.stringContaining("配置已变化") }
    });
  });

  it("validates the renderer envelope and keeps saved target input off the API", () => {
    expect(() =>
      command("models.mergeSiteOfficialQuota", {
        sourceKey: "",
        targetRevision: "bad"
      })
    ).toThrow();
    const result = command("models.mergeSiteOfficialQuota", {
      sourceKey: source,
      targetRevision: "10000000-0000-4000-8000-000000000001",
      apiKey: target
    });
    expect(result.payload).not.toHaveProperty("apiKey");
  });
});
