import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("electron", () => ({
  net: { fetch: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}));
import { MarketplaceAccountClient } from "./marketplace-account-client";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
it("requires the shared login, attaches its token and clears a revoked session", async () => {
  const root = await mkdtemp(join(tmpdir(), "backup-login-"));
  roots.push(root);
  const baseUrl = "https://api.example.test";
  const url = `${baseUrl}/deepwrite/v1/backups/manifest.json`;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        data: {
          token: "dw_user_invalid-test-token",
          expires_at: "2099-01-01T00:00:00Z",
          user: {
            id: "u1",
            username: "writer",
            display_name: "Writer",
            email: "writer@example.test",
            avatar_url: "",
            bio: "",
            role: "user",
            status: "active",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z"
          }
        }
      })
    )
    .mockResolvedValueOnce(new Response("{}"))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  const client = new MarketplaceAccountClient(root, { baseUrl, fetcher });
  await expect(client.fetchBackup(url)).rejects.toMatchObject({
    code: "marketplace.unauthorized"
  });
  expect(fetcher).not.toHaveBeenCalled();
  await client.login({ username: "writer", password: "invalid-test-password" });
  await client.fetchBackup(url, {
    method: "GET",
    headers: { "X-Backup-Key": "DW-AAAA-BBBB-CCCC-DDDD" }
  });
  const headers = new Headers(fetcher.mock.calls[1]![1]?.headers);
  expect(headers.get("Authorization")).toBe(
    "Bearer dw_user_invalid-test-token"
  );
  expect(headers.get("X-Backup-Key")).toBe("DW-AAAA-BBBB-CCCC-DDDD");
  await expect(
    client.fetchBackup(
      "https://other.example.test/deepwrite/v1/backups/manifest.json"
    )
  ).rejects.toThrow("地址无效");
  await expect(client.fetchBackup(url)).rejects.toMatchObject({
    code: "marketplace.unauthorized"
  });
  await expect(client.fetchBackup(url)).rejects.toMatchObject({
    code: "marketplace.unauthorized"
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
