import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  net: { fetch: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

import { MarketplaceClient } from "./marketplace-client";

const roots: string[] = [];
const NOW = "2026-08-11T08:00:00.000Z";
const EXPIRES = "2026-09-10T08:00:00.000Z";
const TOKEN = "dw_user_obviously-invalid-test-token";
const REPLACEMENT_TOKEN = "dw_user_obviously-invalid-replacement-token";

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-marketplace-client-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

function user() {
  return {
    id: "user-test",
    username: "writer-test",
    email: "writer@example.test",
    display_name: "测试作者",
    avatar_url: "",
    bio: "",
    role: "user",
    status: "active",
    created_at: NOW,
    updated_at: NOW
  };
}

function authResponse(token = TOKEN): Response {
  return Response.json({
    data: { user: user(), token, expires_at: EXPIRES }
  });
}

function skillSummary() {
  return {
    content_type: "skill",
    id: "remote-skill",
    owner_user_id: "user-test",
    title: "转折留白",
    overview: "",
    kind: "style",
    library_type: "short",
    stage_id: "draft",
    version: 1,
    cover_url: "",
    visibility: "public",
    status: "published",
    enabled: true,
    download_count: 0,
    like_count: 0,
    liked_by_me: false,
    item_count: 0,
    owner_username: "writer-test",
    owner_name: "测试作者",
    owner_avatar_url: "",
    metadata: {},
    published_at: NOW,
    created_at: NOW,
    updated_at: NOW
  };
}

const encryptedStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value: Buffer) =>
    value.toString("utf8").replace(/^encrypted:/u, "")
};

describe("MarketplaceClient", () => {
  it("joins the configured base, never reuses the public-data key, and encrypts sessions", async () => {
    const root = await temporaryRoot();
    vi.stubEnv(
      "MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_KEY",
      "must-not-cross-boundary"
    );
    const requests: Array<{ url: string; headers: Headers; body?: string }> =
      [];
    const fetcher = async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        headers: new Headers(init?.headers),
        ...(typeof init?.body === "string" ? { body: init.body } : {})
      });
      return authResponse();
    };
    const client = new MarketplaceClient(root, {
      baseUrl: "https://relay.example.test/prefix/",
      fetcher,
      secureStorage: encryptedStorage,
      now: () => Date.parse(NOW)
    });

    const session = await client.register({
      username: "writer-test",
      password: "invalid-test-password"
    });

    expect(session).toMatchObject({ authenticated: true, persistent: true });
    expect(requests[0]?.url).toBe(
      "https://relay.example.test/prefix/market/v1/auth/register"
    );
    expect(requests[0]?.headers.get("Authorization")).toBeNull();
    expect(requests[0]?.body).not.toContain("must-not-cross-boundary");
    const stored = await readFile(
      join(root, "config", "marketplace-session.json"),
      "utf8"
    );
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain("invalid-test-password");
    expect(stored).toContain(
      Buffer.from(`encrypted:${TOKEN}`).toString("base64")
    );
  });

  it("keeps the token in memory only when secure storage is unavailable", async () => {
    const root = await temporaryRoot();
    const client = new MarketplaceClient(root, {
      baseUrl: "https://relay.example.test",
      fetcher: async () => authResponse(),
      secureStorage: {
        ...encryptedStorage,
        isEncryptionAvailable: () => false
      },
      now: () => Date.parse(NOW)
    });

    const session = await client.login({
      username: "writer-test",
      password: "invalid-test-password"
    });
    expect(session).toMatchObject({ authenticated: true, persistent: false });
    await expect(
      stat(join(root, "config", "marketplace-session.json"))
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("serializes a local skill group as nested skill libraries", async () => {
    const root = await temporaryRoot();
    const bodies: unknown[] = [];
    const client = new MarketplaceClient(root, {
      baseUrl: "https://relay.example.test",
      fetcher: async (_url, init) => {
        if (init?.method === "POST" && typeof init.body === "string") {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          if ("username" in body) return authResponse();
          bodies.push(body);
        }
        return Response.json({
          data: {
            id: "remote-group",
            owner_user_id: "user-test",
            title: "本地技能组",
            overview: "",
            version: 1,
            cover_url: "",
            visibility: "public",
            status: "pending",
            download_count: 0,
            metadata: {},
            created_at: NOW,
            updated_at: NOW,
            items: []
          }
        });
      },
      secureStorage: {
        ...encryptedStorage,
        isEncryptionAvailable: () => false
      },
      now: () => Date.parse(NOW)
    });
    await client.login({
      username: "writer-test",
      password: "invalid-test-password"
    });

    await client.publish({
      contentType: "group",
      title: "本地技能组",
      overview: "",
      libraries: [
        {
          title: "通用技能库",
          overview: "",
          kind: "general",
          libraryType: "short",
          entries: [
            {
              stageId: "draft",
              title: "推进正文",
              content: "明显无害的测试正文"
            }
          ]
        }
      ]
    });

    expect(bodies).toEqual([
      {
        title: "本地技能组",
        overview: "",
        metadata: { source: "deepwrite-desktop" },
        libraries: [
          {
            title: "通用技能库",
            overview: "",
            kind: "general",
            library_type: "short",
            entries: [
              {
                stage_id: "draft",
                title: "推进正文",
                body: "明显无害的测试正文"
              }
            ]
          }
        ]
      }
    ]);
  });

  it("clears an encrypted session after a 401 response", async () => {
    const root = await temporaryRoot();
    const first = new MarketplaceClient(root, {
      baseUrl: "https://relay.example.test",
      fetcher: async () => authResponse(),
      secureStorage: encryptedStorage,
      now: () => Date.parse(NOW)
    });
    await first.login({
      username: "writer-test",
      password: "invalid-test-password"
    });

    const reopened = new MarketplaceClient(root, {
      baseUrl: "https://relay.example.test",
      fetcher: async () =>
        Response.json(
          { error: { code: "user_unauthorized", message: "会话无效" } },
          { status: 401 }
        ),
      secureStorage: encryptedStorage,
      now: () => Date.parse(NOW)
    });
    expect(await reopened.session()).toMatchObject({ authenticated: false });
    await expect(
      stat(join(root, "config", "marketplace-session.json"))
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("preserves the login endpoint error instead of reporting an expired session", async () => {
    const root = await temporaryRoot();
    const client = new MarketplaceClient(root, {
      baseUrl: "https://relay.example.test",
      fetcher: async () =>
        Response.json(
          {
            error: {
              code: "invalid_credentials",
              message: "用户名或密码不正确"
            }
          },
          { status: 401 }
        ),
      secureStorage: encryptedStorage,
      now: () => Date.parse(NOW)
    });

    await expect(
      client.login({
        username: "writer-test",
        password: "obviously-invalid-test-password"
      })
    ).rejects.toMatchObject({
      code: "invalid_credentials",
      message: "用户名或密码不正确",
      status: 401
    });
  });

  it("does not let a stale 401 clear a newer login session", async () => {
    const root = await temporaryRoot();
    let loginCount = 0;
    let resolveStaleRequest: ((response: Response) => void) | undefined;
    let markStaleRequestStarted: (() => void) | undefined;
    const staleRequestStarted = new Promise<void>((resolve) => {
      markStaleRequestStarted = resolve;
    });
    const staleResponse = new Promise<Response>((resolve) => {
      resolveStaleRequest = resolve;
    });
    let listAuthorization = "";
    const client = new MarketplaceClient(root, {
      baseUrl: "https://relay.example.test",
      fetcher: async (url, init) => {
        if (url.endsWith("/auth/login")) {
          loginCount += 1;
          return authResponse(loginCount === 1 ? TOKEN : REPLACEMENT_TOKEN);
        }
        if (url.endsWith("/me")) {
          markStaleRequestStarted?.();
          return staleResponse;
        }
        listAuthorization =
          new Headers(init?.headers).get("Authorization") ?? "";
        return Response.json({
          data: {
            items: [],
            page: 1,
            page_size: 20,
            total: 0,
            total_pages: 0
          }
        });
      },
      secureStorage: encryptedStorage,
      now: () => Date.parse(NOW)
    });

    await client.login({
      username: "writer-test",
      password: "obviously-invalid-test-password"
    });
    const staleSessionRequest = client.session();
    await staleRequestStarted;
    await client.login({
      username: "writer-test",
      password: "obviously-invalid-replacement-password"
    });
    resolveStaleRequest?.(
      Response.json(
        { error: { code: "user_unauthorized", message: "会话无效" } },
        { status: 401 }
      )
    );

    await expect(staleSessionRequest).resolves.toMatchObject({
      authenticated: true
    });
    await client.list();
    expect(listAuthorization).toBe(`Bearer ${REPLACEMENT_TOKEN}`);
    const stored = await readFile(
      join(root, "config", "marketplace-session.json"),
      "utf8"
    );
    expect(stored).toContain(
      Buffer.from(`encrypted:${REPLACEMENT_TOKEN}`).toString("base64")
    );
  });

  it("flags HTTP transport and rejects malformed marketplace responses", async () => {
    const root = await temporaryRoot();
    const client = new MarketplaceClient(root, {
      baseUrl: "http://relay.example.test:8080",
      fetcher: async () => Response.json({ data: [{ id: "missing-fields" }] }),
      secureStorage: {
        ...encryptedStorage,
        isEncryptionAvailable: () => false
      }
    });

    expect(await client.session()).toMatchObject({
      authenticated: false,
      insecureTransport: true
    });
    await expect(client.list()).rejects.toThrow();
  });

  it("returns a useful network error and retains the original failure", async () => {
    const root = await temporaryRoot();
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
      code: "ENOTFOUND"
    });
    const transportError = new TypeError("fetch failed", { cause });
    const client = new MarketplaceClient(root, {
      baseUrl: "https://relay.example.test",
      fetcher: async () => {
        throw transportError;
      },
      secureStorage: encryptedStorage
    });

    await expect(
      client.register({
        username: "writer-test",
        password: "invalid-test-password"
      })
    ).rejects.toMatchObject({
      code: "marketplace.network_error",
      message: "无法解析技能广场服务器地址，请检查 DNS 或网络连接。",
      cause: transportError
    });
  });

  it("requests and normalizes page-based marketplace results", async () => {
    const root = await temporaryRoot();
    let requestedURL = "";
    const client = new MarketplaceClient(root, {
      baseUrl: "https://relay.example.test",
      fetcher: async (url) => {
        requestedURL = url;
        return Response.json({
          data: {
            items: [skillSummary()],
            page: 2,
            page_size: 20,
            total: 21,
            total_pages: 2
          }
        });
      },
      secureStorage: {
        ...encryptedStorage,
        isEncryptionAvailable: () => false
      }
    });

    const result = await client.list({ page: 2, pageSize: 20 });

    expect(requestedURL).toContain("page=2");
    expect(requestedURL).toContain("page_size=20");
    expect(result).toMatchObject({
      page: 2,
      pageSize: 20,
      total: 21,
      totalPages: 2
    });
    expect(result.items).toHaveLength(1);
  });

  it("updates an owned publication visibility through the enabled endpoint", async () => {
    const root = await temporaryRoot();
    const requests: Array<{ url: string; method?: string; body?: string }> = [];
    const client = new MarketplaceClient(root, {
      baseUrl: "https://relay.example.test",
      fetcher: async (url, init) => {
        if (url.endsWith("/auth/login")) return authResponse();
        requests.push({
          url,
          ...(init?.method ? { method: init.method } : {}),
          ...(typeof init?.body === "string" ? { body: init.body } : {})
        });
        return Response.json({
          data: {
            content_type: "skill",
            id: "remote-skill",
            owner_user_id: "user-test",
            title: "转折留白",
            overview: "",
            kind: "style",
            library_type: "short",
            stage_id: "draft",
            version: 1,
            cover_url: "",
            visibility: "public",
            status: "published",
            enabled: true,
            download_count: 0,
            like_count: 0,
            liked_by_me: false,
            item_count: 0,
            owner_username: "writer-test",
            owner_name: "测试作者",
            owner_avatar_url: "",
            metadata: {},
            published_at: NOW,
            created_at: NOW,
            updated_at: NOW
          }
        });
      },
      secureStorage: {
        ...encryptedStorage,
        isEncryptionAvailable: () => false
      },
      now: () => Date.parse(NOW)
    });
    await client.login({
      username: "writer-test",
      password: "invalid-test-password"
    });

    const updated = await client.setEnabled({
      contentType: "skill",
      id: "remote-skill",
      enabled: true
    });

    expect(updated.enabled).toBe(true);
    expect(requests).toEqual([
      {
        url: "https://relay.example.test/market/v1/skill-content/skill/remote-skill/enabled",
        method: "PUT",
        body: JSON.stringify({ enabled: true })
      }
    ]);
  });

  it("keeps a successful local install when remote download counting fails", async () => {
    const root = await temporaryRoot();
    const operations: string[] = [];
    const client = new MarketplaceClient(root, {
      baseUrl: "https://relay.example.test",
      fetcher: async (url, init) => {
        if (init?.method === "GET") {
          operations.push("detail");
          return Response.json({
            data: {
              id: "remote-skill",
              owner_user_id: "user-author",
              title: "转折留白",
              overview: "在转折前控制节奏",
              stage_id: "draft",
              kind: "style",
              library_type: "short",
              content: "转折前先留出一个短场景。",
              cover_url: "",
              metadata: {},
              visibility: "public",
              status: "published",
              version: 1,
              download_count: 0,
              published_at: NOW,
              created_at: NOW,
              updated_at: NOW
            }
          });
        }
        expect(url).toContain(
          "/market/v1/skill-content/skill/remote-skill/download"
        );
        operations.push("download-count");
        return Response.json(
          { error: { code: "temporary_failure", message: "计数暂不可用" } },
          { status: 503 }
        );
      },
      secureStorage: {
        ...encryptedStorage,
        isEncryptionAvailable: () => false
      },
      installPackage: async (input) => {
        operations.push("local-install");
        return {
          source: {
            contentType: input.source.contentType,
            id: input.source.contentId
          },
          version: input.source.version,
          title: input.title,
          alreadyInstalled: false,
          libraryIds: ["local-library"]
        };
      }
    });

    const result = await client.install({
      ref: { contentType: "skill", id: "remote-skill" },
      targetLibraryId: "local-library"
    });

    expect(operations).toEqual(["detail", "local-install", "download-count"]);
    expect(result).toMatchObject({
      alreadyInstalled: false,
      libraryIds: ["local-library"],
      downloadCounted: false
    });
  });
});
