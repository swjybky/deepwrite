import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { MarketplacePublishInput } from "@deepwrite/contracts";
import { CommandEnvelopeSchema, createEnvelope } from "@deepwrite/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  sender: {},
  handlers: new Map<
    string,
    (event: { sender: unknown }, request: unknown) => Promise<unknown>
  >()
}));

vi.mock("electron", () => ({
  net: { fetch: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: {
    handle: (
      channel: string,
      handler: (
        event: { sender: unknown },
        request: unknown
      ) => Promise<unknown>
    ) => bridge.handlers.set(channel, handler)
  },
  ipcRenderer: {
    invoke: async (channel: string, request: unknown) => {
      const handler = bridge.handlers.get(channel);
      if (!handler) throw new Error("Missing test IPC handler");
      return handler({ sender: bridge.sender }, request);
    }
  }
}));

import { MarketplaceClient } from "./marketplace-client";
import { registerMarketplaceIpc } from "./ipc/marketplace-ipc";
import { marketplace } from "../preload/marketplace-api";
import { FolderCatalogStore } from "../utilities/folder-catalog-store";

const roots: string[] = [];
const NOW = "2030-01-01T00:00:00.000Z";
const UPDATED = "2030-01-02T00:00:00.000Z";

afterEach(async () => {
  bridge.handlers.clear();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

const entry = {
  stageId: "draft",
  title: "推进正文",
  content: "测试技能正文"
} as const;
const library = {
  title: "测试技能库",
  overview: "",
  kind: "general",
  libraryType: "short",
  entries: [entry]
} as const;

const publications: Array<{
  collection: string;
  input: MarketplacePublishInput;
}> = [
  {
    collection: "skills",
    input: {
      contentType: "skill",
      title: entry.title,
      overview: "",
      stageId: "draft",
      kind: "general",
      libraryType: "short",
      content: entry.content
    }
  },
  {
    collection: "skill-libraries",
    input: { ...library, entries: [entry], contentType: "library" }
  },
  {
    collection: "skill-groups",
    input: {
      contentType: "group",
      title: "本地技能组",
      overview: "",
      libraries: [{ ...library, entries: [entry] }]
    }
  },
  {
    collection: "skill-groups",
    input: {
      contentType: "group",
      title: "引用技能组",
      overview: "",
      items: [{ contentType: "library", id: "existing-library" }]
    }
  }
];

function summary(input: MarketplacePublishInput, enabled: boolean) {
  return {
    content_type: input.contentType,
    id: "new-publication",
    title: input.title,
    overview: input.overview,
    version: 1,
    cover_url: "",
    visibility: "public",
    status: "pending",
    enabled,
    download_count: 0,
    like_count: 0,
    liked_by_me: false,
    item_count: input.contentType === "skill" ? 0 : 1,
    owner_username: "test-writer",
    owner_name: "测试作者",
    owner_avatar_url: "",
    metadata: {},
    created_at: NOW,
    updated_at: enabled ? UPDATED : NOW
  };
}

function detail(input: MarketplacePublishInput, enabled?: boolean) {
  const base = summary(input, enabled ?? false);
  const raw: Record<string, unknown> =
    input.contentType === "skill"
      ? {
          ...base,
          stage_id: input.stageId,
          kind: input.kind,
          library_type: input.libraryType,
          content: input.content
        }
      : input.contentType === "library"
        ? {
            ...base,
            kind: input.kind,
            library_type: input.libraryType,
            skills: []
          }
        : { ...base, items: [] };
  if (enabled === undefined) delete raw.enabled;
  return raw;
}

async function harness(
  publication = publications[0]!,
  options: {
    initiallyEnabled?: boolean;
    enableFails?: boolean;
    publishFails?: boolean;
    staysDisabled?: boolean;
  } = {}
) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-publication-"));
  roots.push(root);
  const requests: Array<{
    method: string;
    path: string;
    body: unknown;
    authorization: string | null;
  }> = [];
  let enabled = options.initiallyEnabled ?? false;
  const client = new MarketplaceClient(root, {
    baseUrl: "https://marketplace.example.test",
    now: () => Date.parse(NOW),
    fetcher: async (url, init) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/auth/login")) {
        return Response.json({
          data: {
            user: {
              id: "test-user",
              username: "test-writer",
              display_name: "测试作者",
              created_at: NOW
            },
            token: "dw_user_obviously-invalid-marketplace-test-token",
            expires_at: "2030-02-01T00:00:00.000Z"
          }
        });
      }
      requests.push({
        method: init?.method ?? "GET",
        path,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        authorization: new Headers(init?.headers).get("Authorization")
      });
      if (path.endsWith("/enabled")) {
        if (options.enableFails)
          return Response.json({ message: "offline" }, { status: 503 });
        enabled = !options.staysDisabled;
        return Response.json({ data: summary(publication.input, enabled) });
      }
      if (init?.method === "GET") {
        return Response.json({
          data: {
            items: [summary(publication.input, enabled)],
            page: 1,
            page_size: 20,
            total: 1,
            total_pages: 1
          }
        });
      }
      if (options.publishFails)
        return Response.json({ message: "upload failed" }, { status: 503 });
      return Response.json({
        data: detail(publication.input, options.initiallyEnabled)
      });
    }
  });
  registerMarketplaceIpc({
    getMainWindow: () =>
      ({
        isDestroyed: () => false,
        webContents: bridge.sender
      }) as unknown as BrowserWindow,
    getMarketplaceClient: () => client
  });
  await marketplace.login({
    username: "test-writer",
    password: "obviously-invalid-test-password"
  });
  return { requests };
}

describe("marketplace publication through Main and Preload", () => {
  it.each(publications)(
    "enables new $input.contentType content from $input.title before approval",
    async (publication) => {
      const { requests } = await harness(publication, {
        initiallyEnabled: false
      });

      const published = await marketplace.publish(publication.input);

      expect(published).toMatchObject({
        id: "new-publication",
        enabled: true,
        status: "pending",
        updatedAt: UPDATED
      });
      expect(requests.map(({ method, path }) => ({ method, path }))).toEqual([
        { method: "POST", path: `/market/v1/${publication.collection}` },
        {
          method: "PUT",
          path: `/market/v1/skill-content/${publication.input.contentType}/new-publication/enabled`
        }
      ]);
      expect(requests[1]).toMatchObject({
        body: { enabled: true },
        authorization: "Bearer dw_user_obviously-invalid-marketplace-test-token"
      });
      const mine = await marketplace.listMine();
      expect(mine.items[0]).toMatchObject({
        id: published.id,
        enabled: true,
        status: "pending"
      });
    }
  );

  it("enables older server responses that omit the visibility flag", async () => {
    const { requests } = await harness();
    expect(await marketplace.publish(publications[0]!.input)).toMatchObject({
      enabled: true
    });
    expect(requests).toHaveLength(2);
  });

  it("avoids another visibility request when the server already enabled the content", async () => {
    const { requests } = await harness(publications[0], {
      initiallyEnabled: true
    });
    expect(await marketplace.publish(publications[0]!.input)).toMatchObject({
      enabled: true
    });
    expect(requests).toHaveLength(1);
  });

  it.each([{ enableFails: true }, { staysDisabled: true }])(
    "preserves a successful upload when activation is unsuccessful: %j",
    async (options) => {
      const { requests } = await harness(publications[0], options);
      expect(await marketplace.publish(publications[0]!.input)).toMatchObject({
        id: "new-publication",
        enabled: false,
        status: "pending"
      });
      expect(requests).toHaveLength(2);
      expect(requests.filter(({ method }) => method === "POST")).toHaveLength(
        1
      );
      expect((await marketplace.listMine()).items[0]).toMatchObject({
        enabled: false
      });
    }
  );

  it("does not enable or retry a failed upload", async () => {
    const { requests } = await harness(publications[0], { publishFails: true });
    await expect(marketplace.publish(publications[0]!.input)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it("preserves the author's disabled visibility when updating existing content", async () => {
    const { requests } = await harness(publications[0], {
      initiallyEnabled: false
    });
    expect(
      await marketplace.update({
        id: "new-publication",
        content: publications[0]!.input
      })
    ).toMatchObject({ enabled: false, status: "pending" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "PUT",
      path: "/market/v1/skills/new-publication"
    });
    expect(requests[0]!.body).not.toHaveProperty("enabled");
  });
});

it("adds a legacy material through the marketplace bridge and persists its Markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-material-bridge-"));
  roots.push(root);
  const store = new FolderCatalogStore({ userDataPath: join(root, "catalog") });
  const fixture = {
    id: "legacy-library",
    domain: "material",
    title: "旧素材库",
    overview: "",
    kind: "plot",
    version: 2,
    library_type: "long",
    parent_genre: "",
    sub_genre: "",
    entries: [{ stage_id: "character", title: "人物", body: "旧素材正文\n" }]
  };
  const client = new MarketplaceClient(root, {
    baseUrl: "https://relay.example.test",
    fetcher: async (url) =>
      Response.json({
        data: new URL(url).pathname.endsWith("/libraries") ? [fixture] : fixture
      }),
    installMaterial: async (input) => {
      const command = CommandEnvelopeSchema.parse(
        createEnvelope("catalog.installMarketplaceMaterial", input, {
          id: "material-install",
          correlationId: "material-install"
        })
      );
      if (command.type !== "catalog.installMarketplaceMaterial")
        throw new Error("Wrong command");
      return store.installMarketplaceMaterial(command.payload);
    }
  });
  registerMarketplaceIpc({
    getMainWindow: () =>
      ({
        isDestroyed: () => false,
        webContents: bridge.sender
      }) as BrowserWindow,
    getMarketplaceClient: () => client
  });
  const [summary] = await marketplace.listMaterials();
  expect(summary).toMatchObject({ id: fixture.id, kind: "plot" });
  const detail = await marketplace.materialDetail(summary!.id);
  const result = await marketplace.installMaterial({
    id: detail.id,
    version: detail.version
  });
  expect((await store.snapshot()).materials).toMatchObject([
    {
      id: result.libraryId,
      materialKind: "plot",
      entries: [{ stageId: "character", title: "人物", body: "旧素材正文\n" }]
    }
  ]);
});
