import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ safeStorage: {} }));
import { MarketplaceAccountClient } from "./marketplace-account-client";

const token = "dw_user_obviously-invalid-permanent-test-token";
const user = {
  id: "permanent-test",
  username: "test-writer",
  display_name: "测试作者",
  avatar_url: "",
  bio: "",
  created_at: "2026-01-01T00:00:00.000Z"
};
const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, "")
};
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-permanent-session-"));
  roots.push(root);
  let expiry: string | null = null;
  let unauthorized = false;
  const requests: Array<{
    url: string;
    method: string;
    authorization: string | null;
  }> = [];
  const options = {
    baseUrl: "https://account.example.test",
    secureStorage,
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    fetcher: async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("Authorization")
      });
      if (url.endsWith("/auth/login"))
        return Response.json({ data: { token, user, expires_at: expiry } });
      if (unauthorized)
        return Response.json(
          { error: { code: "user_unauthorized", message: "Session revoked" } },
          { status: 401 }
        );
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ data: user });
    }
  };
  const first = new MarketplaceAccountClient(root, options);
  return {
    root,
    options,
    first,
    requests,
    setUnauthorized: () => {
      unauthorized = true;
    },
    setLegacyExpiry: () => {
      expiry = "2026-01-31T00:00:00.000Z";
    }
  };
}
async function login(client: MarketplaceAccountClient) {
  return client.login({
    username: "test-writer",
    password: "obviously-invalid-password"
  });
}

describe("permanent marketplace sessions", () => {
  it("encrypts and restores a login without expiry even after many years", async () => {
    const { root, options, first, requests } = await setup();
    const session = await login(first);
    expect(session).toMatchObject({ authenticated: true, persistent: true });
    expect(session.expiresAt).toBeUndefined();
    const stored = await readFile(
      join(root, "config", "marketplace-session.json"),
      "utf8"
    );
    expect(JSON.parse(stored).expiresAt).toBeUndefined();
    expect(stored).not.toContain(token);
    expect(stored).not.toContain("obviously-invalid-password");
    const reopened = new MarketplaceAccountClient(root, {
      ...options,
      now: () => Date.parse("2126-01-01T00:00:00.000Z")
    });
    expect(await reopened.session()).toMatchObject({
      authenticated: true,
      persistent: true
    });
    expect(requests.at(-1)?.authorization).toBe(`Bearer ${token}`);
    await reopened.logout();
    expect(requests.at(-1)?.method).toBe("DELETE");
    await expect(
      stat(join(root, "config", "marketplace-session.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await new MarketplaceAccountClient(root, options).session()
    ).toMatchObject({ authenticated: false });
  });

  it("still clears a permanent login when the server revokes it", async () => {
    const { root, options, first, setUnauthorized } = await setup();
    await login(first);
    setUnauthorized();
    expect(
      await new MarketplaceAccountClient(root, options).session()
    ).toMatchObject({ authenticated: false });
    await expect(
      stat(join(root, "config", "marketplace-session.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("continues to honor expiry on legacy sessions", async () => {
    const { root, options, first, setLegacyExpiry, requests } = await setup();
    setLegacyExpiry();
    await login(first);
    const count = requests.length;
    const reopened = new MarketplaceAccountClient(root, {
      ...options,
      now: () => Date.parse("2026-02-01T00:00:00.000Z")
    });
    expect(await reopened.session()).toMatchObject({ authenticated: false });
    expect(requests).toHaveLength(count);
  });
});
