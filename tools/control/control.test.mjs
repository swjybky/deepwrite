import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkCommands } from "./commands/check.mjs";
import { envCommands } from "./commands/env.mjs";
import { openControlSession } from "./lib/control-client.mjs";
import { backendChangesSince, classifyLog } from "./lib/doctor.mjs";
import {
  assertInsideTestEnvironment,
  resolveTestRoot,
  testLayout
} from "./lib/paths.mjs";
import { run } from "./lib/runner.mjs";

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
    { env: envCommands, check: checkCommands },
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

async function sourceProfile() {
  const profile = join(scratch, "real-profile");
  await mkdir(join(profile, "config"), { recursive: true });
  await writeFile(
    join(profile, "config", "models.json"),
    JSON.stringify({
      version: 1,
      defaultModelId: "other",
      models: [
        { id: "deepwrite-site-official-deepseek-flash" },
        { id: "other" }
      ]
    })
  );
  await writeFile(join(profile, "config", "marketplace-session.json"), "{}");
  await writeFile(join(profile, "config", "device-sync.json"), "{}");
  await writeFile(join(profile, "config", "agent-teams.json"), "{}");
  return profile;
}

describe("runner", () => {
  it("answers unknown commands with a next step and exit code 2", async () => {
    const { exitCode, result } = await ctl("env", "nope");
    expect(exitCode).toBe(2);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "cli.unknown_command",
        nextSteps: ["运行 pnpm -s ctl env --help 查看本组命令"]
      }
    });
  });

  it("rejects unknown options instead of ignoring them", async () => {
    const { exitCode, result } = await ctl("env", "reset", "--force");
    expect(exitCode).toBe(2);
    expect(result.error.code).toBe("cli.invalid_arguments");
  });

  it("describes every command as JSON", async () => {
    const { result } = await ctl("env", "seed", "--help");
    expect(result.data.usage).toBe(
      "pnpm -s ctl env seed [--from <数据目录>] [--dry-run] [--env <值>]"
    );
    expect(result.data.errors).toHaveProperty("env.running");
  });

  it("runs just the requested repository rule", async () => {
    const { exitCode, result } = await ctl(
      "check",
      "rules",
      "dependency-sources"
    );
    expect(exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(Object.keys(result.data.rules)).toEqual(["dependency-sources"]);
  });
});

describe("guards", () => {
  it("refuses a test root that overlaps real data", () => {
    expect(() =>
      resolveTestRoot({
        env: { DEEPWRITE_TEST_ROOT: "/home/writer" },
        home: "/home/writer"
      })
    ).toThrow(expect.objectContaining({ code: "guard.unsafe_test_root" }));
    expect(() =>
      resolveTestRoot({
        env: { DEEPWRITE_TEST_ROOT: "/home/writer/Documents/test" },
        home: "/home/writer"
      })
    ).toThrow(expect.objectContaining({ code: "guard.unsafe_test_root" }));
  });

  it("refuses paths outside the environment", () => {
    const layout = testLayout();
    expect(assertInsideTestEnvironment(layout, layout.config)).toBe(
      layout.config
    );
    expect(() =>
      assertInsideTestEnvironment(layout, join(layout.root, ".."))
    ).toThrow(expect.objectContaining({ code: "guard.outside_test_root" }));
  });

  it("rejects invalid environment names", async () => {
    const { result } = await ctl("env", "status", "--env", "../real");
    expect(result.error.code).toBe("cli.invalid_env_name");
  });
});

describe("env seed", () => {
  it("previews without writing anything", async () => {
    const from = await sourceProfile();
    const { exitCode, result } = await ctl(
      "env",
      "seed",
      "--from",
      from,
      "--dry-run"
    );
    expect(exitCode).toBe(0);
    expect(
      result.data.copy.find((copy) => copy.file === "models.json").present
    ).toBe(true);
    expect(await exists(testLayout().root)).toBe(false);
  });

  it("copies only the whitelist, leaves the source untouched and picks the test model", async () => {
    const from = await sourceProfile();
    const before = await readFile(join(from, "config", "models.json"), "utf8");
    const { result } = await ctl("env", "seed", "--from", from);
    const layout = testLayout();

    expect(result.data.copied).toEqual([
      "models.json",
      "marketplace-session.json"
    ]);
    expect(result.data.defaultModel).toEqual({
      id: "deepwrite-site-official-deepseek-flash"
    });
    expect(await exists(join(layout.config, "device-sync.json"))).toBe(false);
    expect(await exists(join(layout.config, "agent-teams.json"))).toBe(false);
    expect(await readFile(join(from, "config", "models.json"), "utf8")).toBe(
      before
    );
    expect(
      JSON.parse(
        await readFile(join(layout.config, "workspace-directory.json"), "utf8")
      )
    ).toEqual({ version: 1, path: layout.workspace });
    expect(
      JSON.parse(
        await readFile(join(layout.config, "general-settings.json"), "utf8")
      )
    ).toMatchObject({ externalControlEnabled: true, showInMenuBar: false });
  });

  it("explains how to recover when the source has no models", async () => {
    const from = join(scratch, "empty-profile");
    await mkdir(join(from, "config"), { recursive: true });
    const { exitCode, result } = await ctl("env", "seed", "--from", from);
    expect(exitCode).toBe(2);
    expect(result.error.code).toBe("seed.source_missing");
    expect(result.error.nextSteps.length).toBeGreaterThan(0);
  });
});

describe("env reset and destroy", () => {
  it("keeps configuration on reset and lists targets in a dry run", async () => {
    await ctl("env", "seed", "--from", await sourceProfile());
    const layout = testLayout();
    await mkdir(join(layout.workspace, "短篇"), { recursive: true });
    await writeFile(join(layout.profile, "catalog.json"), "{}");

    const preview = await ctl("env", "reset", "--dry-run");
    expect(preview.result.data.removed.sort()).toEqual(
      [
        join(layout.profile, "catalog.json"),
        join(layout.workspace, "短篇")
      ].sort()
    );
    expect(await exists(join(layout.workspace, "短篇"))).toBe(true);

    await ctl("env", "reset");
    expect(await exists(join(layout.workspace, "短篇"))).toBe(false);
    expect(await exists(join(layout.profile, "catalog.json"))).toBe(false);
    expect(await exists(join(layout.config, "models.json"))).toBe(true);
  });

  it("removes the whole environment only without --dry-run", async () => {
    await ctl("env", "seed", "--from", await sourceProfile());
    const layout = testLayout();
    await ctl("env", "destroy", "--dry-run");
    expect(await exists(layout.root)).toBe(true);
    await ctl("env", "destroy");
    expect(await exists(layout.root)).toBe(false);
  });
});

describe("doctor helpers", () => {
  it("finds backend sources changed after startup and skips tests", async () => {
    const main = join(scratch, "apps/desktop/src/main");
    await mkdir(main, { recursive: true });
    const old = new Date(Date.now() - 60_000);
    for (const file of ["old.ts", "new.ts", "new.test.ts"]) {
      await writeFile(join(main, file), "");
    }
    await utimes(join(main, "old.ts"), old, old);
    expect(await backendChangesSince(Date.now() - 30_000, scratch)).toEqual([
      "apps/desktop/src/main/new.ts"
    ]);
  });

  it("separates restart-worthy log errors from warnings", () => {
    expect(
      classifyLog(
        "[vite] Internal server error: boom\nUncaught TypeError: x\nready"
      )
    ).toEqual({
      restart: ["[vite] Internal server error: boom"],
      warnings: ["Uncaught TypeError: x"]
    });
  });
});

describe("control client", () => {
  async function fakeApp(layout, respond) {
    await mkdir(layout.control, { recursive: true });
    // macOS caps socket paths near 104 bytes; the temporary directory is deeper.
    const endpoint = `/tmp/dwctl-${process.pid}-${Date.now()}.sock`;
    const server = createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const message = JSON.parse(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
          socket.write(`${JSON.stringify(respond(message))}\n`);
        }
      });
    });
    await new Promise((resolve) => server.listen(endpoint, resolve));
    await writeFile(
      layout.controlState,
      JSON.stringify({
        status: "ready",
        endpoint,
        token: "t".repeat(32),
        pid: 1
      })
    );
    return server;
  }

  it("authenticates as deepwrite-ctl and returns tool results", async () => {
    const layout = testLayout();
    const seen = [];
    const server = await fakeApp(layout, (message) => {
      seen.push(message);
      return message.type === "externalControl.hello"
        ? { status: "accepted", requestId: message.id, payload: {} }
        : message.payload.tool === "list_works"
          ? {
              status: "accepted",
              requestId: message.id,
              payload: { works: [] }
            }
          : {
              status: "rejected",
              requestId: message.id,
              error: { code: "external.invalid_input", message: "参数无效" }
            };
    });
    try {
      const session = await openControlSession(layout);
      await expect(session.call("list_works")).resolves.toEqual({ works: [] });
      await expect(session.call("write_document")).rejects.toMatchObject({
        code: "app.tool_rejected",
        details: { code: "external.invalid_input" }
      });
      session.close();
      expect(seen[0].payload.client).toEqual({ name: "deepwrite-ctl" });
    } finally {
      server.close();
    }
  });

  it("tells the agent to check the instance when the endpoint is missing", async () => {
    await expect(openControlSession(testLayout())).rejects.toMatchObject({
      code: "app.control_unavailable"
    });
  });
});
