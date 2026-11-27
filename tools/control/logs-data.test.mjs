import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appCommands } from "./commands/app.mjs";
import { dataCommands } from "./commands/data.mjs";
import { logsCommands } from "./commands/logs.mjs";
import {
  findFixtures,
  listFixtures,
  loadFixture,
  readLedger
} from "./lib/fixtures.mjs";
import { resetTargets } from "./lib/instance.mjs";
import {
  logSources,
  readSourceSince,
  resolveMark,
  summarizeProblems,
  writeMark
} from "./lib/logs.mjs";
import { testLayout } from "./lib/paths.mjs";
import { run } from "./lib/runner.mjs";
import { copySnapshotBack, takeSnapshot } from "./lib/snapshots.mjs";

let scratch;
let previousRoot;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "deepwrite-ctl-"));
  previousRoot = process.env.DEEPWRITE_TEST_ROOT;
  process.env.DEEPWRITE_TEST_ROOT = join(scratch, "test-root");
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.DEEPWRITE_TEST_ROOT;
  else process.env.DEEPWRITE_TEST_ROOT = previousRoot;
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
});

async function ctl(...argv) {
  let text = "";
  const stream = new Writable({
    write(chunk, _encoding, done) {
      text += chunk;
      done();
    }
  });
  const exitCode = await run(
    argv,
    { app: appCommands, logs: logsCommands, data: dataCommands },
    stream
  );
  return { exitCode, result: JSON.parse(text) };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("positional arguments", () => {
  it("names a missing argument and shows it in usage", async () => {
    const missing = await ctl("app", "call");
    expect(missing.exitCode).toBe(2);
    expect(missing.result.error).toMatchObject({
      code: "cli.invalid_arguments",
      message: "缺少参数 <tool>。"
    });
    const help = await ctl("data", "restore", "--help");
    expect(help.result.data.usage).toBe(
      "pnpm -s ctl data restore <name> [--dry-run] [--env <值>]"
    );
  });

  it("rejects extra arguments and malformed JSON", async () => {
    const extra = await ctl("data", "snapshot", "a", "b");
    expect(extra.result.error.message).toBe("多余的参数：b");
    const json = await ctl("app", "call", "list_works", "--args", "{bad");
    expect(json.result.error.code).toBe("cli.invalid_arguments");
  });
});

describe("logs", () => {
  it("reads only what was written after a mark, across a restart", async () => {
    const layout = testLayout();
    await mkdir(layout.logs, { recursive: true });
    const first = join(layout.logs, "dev-1.log");
    await writeFile(first, "before\n");
    await writeMark(layout, { logFile: first }, "probe");
    await writeFile(first, "before\nafter in old run\n");
    const second = join(layout.logs, "dev-2.log");
    await writeFile(second, "new run\n");

    const [dev] = logSources(layout, { logFile: second });
    const mark = await resolveMark(layout, "probe");
    const { text, notes } = await readSourceSince(dev, mark);
    expect(text).toBe("after in old run\nnew run\n");
    expect(notes).toHaveLength(1);
  });

  it("counts Main's renderer copy once and skips Vite's relay", () => {
    const problems = summarizeProblems(
      "dev",
      [
        "[renderer:error] boom 1 (http://localhost:5173/a.ts:3)",
        "[renderer:error] boom 2 (http://localhost:5173/a.ts:3)",
        "6:36:20 AM [vite] (client) [console.error] boom 1",
        "[renderer:warning] slow",
        "[renderer:error] ResizeObserver loop limit exceeded",
        "ready in 300ms"
      ],
      /ResizeObserver/iu
    );
    expect(problems).toEqual([
      {
        source: "dev",
        level: "error",
        text: "[renderer:error] boom 1 (http://localhost:5173/a.ts:3)",
        count: 2
      },
      {
        source: "dev",
        level: "warning",
        text: "[renderer:warning] slow",
        count: 1
      }
    ]);
  });

  it("flags crashes and failed model calls in structured logs", () => {
    expect(
      summarizeProblems("startup", [
        { event: "renderer.gone" },
        { event: "window.loaded" }
      ])
    ).toHaveLength(1);
    expect(
      summarizeProblems("model-calls", [
        { status: "error" },
        { status: "completed" }
      ])
    ).toHaveLength(1);
  });

  it("errors on an unknown mark with the command that creates it", async () => {
    const { exitCode, result } = await ctl("logs", "errors", "--since", "nope");
    expect(exitCode).toBe(2);
    expect(result.error.code).toBe("logs.unknown_mark");
    expect(result.error.nextSteps[0]).toContain("logs mark --name nope");
  });
});

describe("fixtures", () => {
  function fakeSession() {
    const calls = [];
    const documents = [
      { id: "plot", title: "剧情设计", group: "stage" },
      {
        id: "draft-section:section-1:body",
        title: "第一节 · 正文",
        group: "draft"
      }
    ];
    return {
      calls,
      async call(tool, args) {
        calls.push([tool, args]);
        if (tool === "manage_work") return { id: "book-1" };
        if (tool === "get_work") return { documents };
        if (tool === "read_document")
          return { revision: `r-${args.documentId}` };
        if (tool === "manage_document")
          return { id: `draft-section:${args.title}:body` };
        if (tool === "manage_library") return { id: "material-1" };
        return {};
      }
    };
  }

  it("ships fixtures that only use synthetic content", async () => {
    const fixtures = await listFixtures();
    expect(fixtures.map(({ name }) => name)).toEqual([
      "libraries",
      "long",
      "short"
    ]);
    await expect(findFixtures("short,nope")).rejects.toMatchObject({
      code: "data.unknown_fixture"
    });
  });

  it("writes documents by title, appends sections and records the ledger", async () => {
    const layout = testLayout();
    const session = fakeSession();
    const fixture = {
      name: "tiny",
      works: [
        {
          type: "short",
          title: "样例",
          genre: "其他",
          documents: { 剧情设计: "设计" },
          sections: [{ title: "第二节", body: "正文二" }]
        }
      ],
      libraries: [
        {
          domain: "material",
          kind: "character",
          title: "库",
          entries: [{ title: "甲", content: "乙" }]
        }
      ]
    };
    await loadFixture(layout, session, fixture);
    const writes = session.calls.filter(([tool]) => tool === "write_document");
    expect(writes.map(([, args]) => args)).toEqual([
      {
        workId: "book-1",
        documentId: "plot",
        content: "设计",
        baseRevision: "r-plot"
      },
      {
        workId: "book-1",
        documentId: "draft-section:第二节:body",
        content: "正文二",
        baseRevision: "r-draft-section:第二节:body"
      }
    ]);
    expect(
      session.calls.find(([tool]) => tool === "manage_document")[1].documentId
    ).toBe("draft-section:section-1:body");
    expect((await readLedger(layout)).items.map(({ id }) => id)).toEqual([
      "book-1",
      "material-1"
    ]);
  });

  it("reports structure drift and keeps what was already created", async () => {
    const layout = testLayout();
    const fixture = {
      name: "drift",
      works: [
        {
          type: "short",
          title: "样例",
          documents: { 不存在: "x" },
          sections: []
        }
      ],
      libraries: []
    };
    await expect(
      loadFixture(layout, fakeSession(), fixture)
    ).rejects.toMatchObject({
      code: "data.fixture_outdated",
      details: { documents: ["剧情设计", "第一节 · 正文"] }
    });
    expect((await readLedger(layout)).items).toHaveLength(1);
  });
});

describe("snapshots", () => {
  it("round-trips data and the ledger, skipping config and caches", async () => {
    const layout = testLayout();
    await mkdir(join(layout.config), { recursive: true });
    await mkdir(join(layout.profile, "Cache"), { recursive: true });
    await mkdir(join(layout.workspace, "雾港来信"), { recursive: true });
    await writeFile(join(layout.config, "models.json"), "seeded");
    await writeFile(join(layout.profile, "Cache", "blob"), "cache");
    await writeFile(join(layout.profile, "catalog.json"), "before");
    await writeFile(join(layout.workspace, "雾港来信", "deepwrite.json"), "{}");
    await writeFile(
      join(layout.root, "fixtures.json"),
      '{"items":[{"id":"book-1"}]}'
    );

    const snapshot = await takeSnapshot(layout, "baseline");
    expect(await exists(join(snapshot.directory, "profile", "config"))).toBe(
      false
    );
    expect(await exists(join(snapshot.directory, "profile", "Cache"))).toBe(
      false
    );

    await writeFile(join(layout.profile, "catalog.json"), "after");
    await rm(join(layout.workspace, "雾港来信"), { recursive: true });
    const targets = await resetTargets(layout);
    expect(targets).toContain(join(layout.root, "fixtures.json"));
    for (const target of targets)
      await rm(target, { recursive: true, force: true });
    await copySnapshotBack(layout, snapshot.directory);

    expect(await readFile(join(layout.profile, "catalog.json"), "utf8")).toBe(
      "before"
    );
    expect(
      await exists(join(layout.workspace, "雾港来信", "deepwrite.json"))
    ).toBe(true);
    expect(await readFile(join(layout.config, "models.json"), "utf8")).toBe(
      "seeded"
    );
    expect((await readLedger(layout)).items).toEqual([{ id: "book-1" }]);
  });

  it("previews a restore without touching data", async () => {
    const layout = testLayout();
    await mkdir(layout.workspace, { recursive: true });
    await writeFile(join(layout.workspace, "a.md"), "a");
    await takeSnapshot(layout, "baseline");
    await writeFile(join(layout.workspace, "b.md"), "b");

    const { result } = await ctl("data", "restore", "baseline", "--dry-run");
    expect(result.data.removed).toContain(join(layout.workspace, "b.md"));
    expect(await exists(join(layout.workspace, "b.md"))).toBe(true);
    const duplicate = await ctl("data", "snapshot", "baseline");
    expect(duplicate.result.error.code).toBe("data.snapshot_exists");
  });
});
