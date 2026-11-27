import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppAlertStore } from "./app-alert-store";

const temporaryRoots: string[] = [];

function manifest(
  desketop = ["欢迎使用 DeepWrite"],
  model = ["模型公告"]
): unknown {
  return { desketop, model };
}

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), label));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50
      })
    )
  );
});

describe("AppAlertStore", () => {
  it("archives distinct desktop announcements once and restores them offline", async () => {
    const root = await temporaryRoot("deepwrite-alerts-history-");
    let messages = ["第一版", "补充说明"];
    let now = Date.parse("2026-10-01T10:00:00.000Z");
    const store = new AppAlertStore(root, {
      configUrl: "https://example.test/ALERT.json",
      now: () => now,
      fetcher: async () => Response.json(manifest(messages))
    });
    const first = await store.getSnapshot();
    await store.acknowledgeDesktop(first.desktopRevision);
    now += 86_400_000;
    expect((await store.getSnapshot()).history).toEqual(first.history);
    messages = ["第二版"];
    const second = await store.getSnapshot();
    expect(second.history?.map((entry) => entry.messages)).toEqual([
      ["第二版"],
      ["第一版", "补充说明"]
    ]);
    expect(second.history?.map((entry) => entry.receivedAt)).toEqual([
      "2026-10-02T10:00:00.000Z",
      "2026-10-01T10:00:00.000Z"
    ]);
    messages = [];
    expect((await store.getSnapshot()).history).toEqual(second.history);
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });
    const offline = new AppAlertStore(root, { fetcher });
    expect((await offline.getSnapshot()).history).toEqual(second.history);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("migrates a legacy cached announcement before a new fetch replaces it", async () => {
    const root = await temporaryRoot("deepwrite-alerts-history-migration-");
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(
      join(root, "config", "app-alert-state.json"),
      JSON.stringify({
        version: 1,
        fetchedAt: "2026-09-01T12:00:00.000Z",
        manifest: manifest(["旧缓存"]),
        history: [{ revision: "invalid", receivedAt: "invalid", messages: [] }]
      })
    );
    const store = new AppAlertStore(root, {
      now: () => Date.parse("2026-10-01T12:00:00.000Z"),
      fetcher: async () => Response.json(manifest(["新公告"]))
    });
    const snapshot = await store.getSnapshot();
    expect(snapshot.history?.map((entry) => entry.messages)).toEqual([
      ["新公告"],
      ["旧缓存"]
    ]);
    expect(snapshot.history?.[1]?.receivedAt).toBe("2026-09-01T12:00:00.000Z");
    const offline = new AppAlertStore(root, {
      fetcher: async () => {
        throw new Error("offline");
      }
    });
    expect((await offline.getSnapshot()).history).toEqual(snapshot.history);
  });

  it("uses only the current remote documentation URL and clears missing, invalid and failed results", async () => {
    const root = await temporaryRoot("deepwrite-alerts-docs-");
    let docsUrl: unknown = " https://example.test/docs?source=app#download ";
    let fail = false;
    const store = new AppAlertStore(root, {
      configUrl: "https://example.test/ALERT.json",
      fetcher: async () => {
        if (fail) throw new Error("offline");
        return new Response(
          JSON.stringify({
            desketop: [],
            model: ["模型公告"],
            officialDocsUrl: docsUrl
          })
        );
      }
    });
    expect((await store.getSnapshot()).officialDocsUrl).toBe(
      "https://example.test/docs?source=app#download"
    );
    const offline = new AppAlertStore(root, {
      configUrl: "https://example.test/ALERT.json",
      fetcher: async () => {
        throw new Error("offline");
      }
    });
    expect((await offline.getSnapshot()).officialDocsUrl).toBeUndefined();
    for (const invalid of [
      undefined,
      null,
      "",
      "  ",
      "invalid",
      "javascript:alert(1)",
      "http://example.test/docs",
      "https://user:pass@example.test/docs",
      "https://example.test/a b",
      "https://example.test/\\docs",
      "https://example.test/" + "x".repeat(2048),
      123
    ]) {
      docsUrl = "https://example.test/docs";
      expect((await store.getSnapshot()).officialDocsUrl).toBe(docsUrl);
      docsUrl = invalid;
      const snapshot = await store.getSnapshot();
      expect(snapshot.officialDocsUrl).toBeUndefined();
      expect(snapshot.modelMessages).toEqual(["模型公告"]);
    }
    docsUrl = "https://example.test/new-docs";
    expect((await store.getSnapshot()).officialDocsUrl).toBe(docsUrl);
    fail = true;
    expect((await store.getSnapshot()).officialDocsUrl).toBeUndefined();
    fail = false;
    expect((await store.getSnapshot()).officialDocsUrl).toBe(docsUrl);
  });

  it("keeps version reminders independent of read announcements and clears removed versions", async () => {
    const root = await temporaryRoot("deepwrite-alerts-version-");
    let version: string | undefined = "v1.5.3";
    const store = new AppAlertStore(root, {
      configUrl: "https://example.test/ALERT.json",
      fetcher: async () =>
        new Response(
          JSON.stringify({
            desketop: ["版本公告"],
            model: ["模型公告"],
            pcLatestVersion: version,
            appLatestVersion: "2.0.0",
            updatedAt: "2026-09-16T11:21:35.981Z"
          })
        )
    });
    const first = await store.getSnapshot();
    expect(first.pcLatestVersion).toBe("1.5.3");
    await store.acknowledgeDesktop(first.desktopRevision);
    version = "1.5.4";
    const next = await store.getSnapshot();
    expect(next.shouldShowDesktop).toBe(false);
    expect(next.pcLatestVersion).toBe("1.5.4");

    const offline = new AppAlertStore(root, {
      configUrl: "https://example.test/ALERT.json",
      fetcher: async () => {
        throw new Error("offline");
      }
    });
    expect((await offline.getSnapshot()).pcLatestVersion).toBe("1.5.4");
    version = undefined;
    expect((await store.getSnapshot()).pcLatestVersion).toBeUndefined();
    version = "invalid";
    const invalid = await store.getSnapshot();
    expect(invalid.pcLatestVersion).toBeUndefined();
    expect(invalid.modelMessages).toEqual(["模型公告"]);
  });

  it("shows each desktop message revision once and keeps model messages visible", async () => {
    const root = await temporaryRoot("deepwrite-alerts-once-");
    const fetcher = async () => new Response(JSON.stringify(manifest()));
    const firstStore = new AppAlertStore(root, { fetcher });
    const first = await firstStore.getSnapshot();

    expect(first.desktopMessages).toEqual(["欢迎使用 DeepWrite"]);
    expect(first.modelMessages).toEqual(["模型公告"]);
    expect(first.shouldShowDesktop).toBe(true);

    await firstStore.acknowledgeDesktop(first.desktopRevision);
    expect((await firstStore.getSnapshot()).shouldShowDesktop).toBe(false);

    const reopenedStore = new AppAlertStore(root, { fetcher });
    expect((await reopenedStore.getSnapshot()).shouldShowDesktop).toBe(false);
  });

  it("shows the desktop dialog again when its normalized content changes", async () => {
    const root = await temporaryRoot("deepwrite-alerts-changed-");
    const firstStore = new AppAlertStore(root, {
      fetcher: async () => new Response(JSON.stringify(manifest(["第一版"])))
    });
    const first = await firstStore.getSnapshot();
    await firstStore.acknowledgeDesktop(first.desktopRevision);

    const changedStore = new AppAlertStore(root, {
      fetcher: async () => new Response(JSON.stringify(manifest(["第二版"])))
    });
    const changed = await changedStore.getSnapshot();

    expect(changed.desktopMessages).toEqual(["第二版"]);
    expect(changed.shouldShowDesktop).toBe(true);
    expect(changed.desktopRevision).not.toBe(first.desktopRevision);
  });

  it("checks again in the same process and bypasses the raw-file cache", async () => {
    const root = await temporaryRoot("deepwrite-alerts-recheck-");
    let desktopMessage = "第一版";
    const requestedUrls: string[] = [];
    let now = 1_000;
    const store = new AppAlertStore(root, {
      now: () => now,
      fetcher: async (url) => {
        requestedUrls.push(url);
        return new Response(JSON.stringify(manifest([desktopMessage])));
      }
    });
    const first = await store.getSnapshot();
    await store.acknowledgeDesktop(first.desktopRevision);

    desktopMessage = "第一版增加几个字";
    now += 1;
    const changed = await store.getSnapshot();

    expect(changed.desktopMessages).toEqual(["第一版增加几个字"]);
    expect(changed.shouldShowDesktop).toBe(true);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]).toContain("deepwrite_cache_bust=1000");
    expect(requestedUrls[1]).toContain("deepwrite_cache_bust=1001");
  });

  it("keeps cached desktop alerts but hides model announcements when offline", async () => {
    const root = await temporaryRoot("deepwrite-alerts-cache-");
    await new AppAlertStore(root, {
      fetcher: async () =>
        new Response(JSON.stringify(manifest(["缓存提醒"], ["缓存模型公告"])))
    }).getSnapshot();

    const offlineStore = new AppAlertStore(root, {
      fetcher: async () => {
        throw new Error("offline");
      }
    });
    const cached = await offlineStore.getSnapshot();

    expect(cached.desktopMessages).toEqual(["缓存提醒"]);
    expect(cached.modelMessages).toEqual([]);
  });

  it("falls back safely when no valid remote or cached config exists", async () => {
    const root = await temporaryRoot("deepwrite-alerts-fallback-");
    const store = new AppAlertStore(root, {
      fetcher: async () => new Response('{"desketop":"invalid"}')
    });
    const fallback = await store.getSnapshot();

    expect(fallback.desktopMessages).toEqual([]);
    expect(fallback.modelMessages).toEqual([]);
    expect(fallback.shouldShowDesktop).toBe(false);
  });

  it("silently hides model announcements after a failed refresh and restores them on recovery", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = await temporaryRoot("deepwrite-alerts-model-recovery-");
    let fail = false;
    const store = new AppAlertStore(root, {
      configUrl: "https://example.test/ALERT.json",
      fetcher: async () => {
        if (fail) throw new Error("offline");
        return new Response(JSON.stringify(manifest()));
      }
    });
    expect((await store.getSnapshot()).modelMessages).toEqual(["模型公告"]);
    fail = true;
    expect((await store.getSnapshot()).modelMessages).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    fail = false;
    expect((await store.getSnapshot()).modelMessages).toEqual(["模型公告"]);
  });

  it.each([undefined, []])(
    "accepts missing or empty model announcements: %j",
    async (model) => {
      const root = await temporaryRoot("deepwrite-alerts-model-empty-");
      const snapshot = await new AppAlertStore(root, {
        configUrl: "https://example.test/ALERT.json",
        fetcher: async () =>
          new Response(JSON.stringify({ desketop: [], model }))
      }).getSnapshot();
      expect(snapshot.modelMessages).toEqual([]);
      expect(snapshot.shouldShowDesktop).toBe(false);
    }
  );
});
