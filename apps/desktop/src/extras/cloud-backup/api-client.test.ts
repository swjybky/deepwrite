import { describe, expect, it, vi } from "vitest";
import { DeepwriteApiObjectStore } from "./api-client";
const key = "DW-AAAA-BBBB-CCCC-DDDD";
const baseUrl = "https://backup.example.test/prefix";
describe("DeepwriteApi backup transport", () => {
  it("uploads bytes through API using only the scoped recovery key", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const store = new DeepwriteApiObjectStore({ baseUrl }, fetcher);
    await store.putObject(
      `backups/${key}/snapshot.zip`,
      Buffer.from("zip"),
      "application/zip"
    );
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${baseUrl}/deepwrite/v1/backups/snapshot.zip`);
    expect(String(url)).not.toContain(key);
    expect(init?.headers).toEqual({
      "X-Backup-Key": key,
      "Content-Type": "application/zip"
    });
    expect(init?.redirect).toBe("error");
    expect(Buffer.from(init?.body as Uint8Array).toString()).toBe("zip");
  });
  it("reads old manifests and treats missing backups as absent", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const store = new DeepwriteApiObjectStore({ baseUrl }, fetcher);
    expect(
      (await store.getObject(`backups/${key}/manifest.json`))?.toString()
    ).toBe("{}");
    expect(await store.getObject(`backups/${key}/manifest.json`)).toBeNull();
  });
  it("rejects arbitrary object paths without making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const store = new DeepwriteApiObjectStore({ baseUrl }, fetcher);
    await expect(store.getObject(`backups/${key}/../other`)).rejects.toThrow(
      "路径无效"
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not expose upstream bodies or network credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("private error", { status: 503 }))
      .mockRejectedValueOnce(new Error("private request"));
    const store = new DeepwriteApiObjectStore({ baseUrl }, fetcher);
    await expect(
      store.getObject(`backups/${key}/manifest.json`)
    ).rejects.toThrow("云端备份操作失败（503）");
    await expect(
      store.getObject(`backups/${key}/manifest.json`)
    ).rejects.toThrow("连接云端备份失败");
  });
  it("caps downloaded manifests", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array(4 * 1024 * 1024 + 1)));
    await expect(
      new DeepwriteApiObjectStore({ baseUrl }, fetcher).getObject(
        `backups/${key}/manifest.json`
      )
    ).rejects.toThrow("大小限制");
  });
});
