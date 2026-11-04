import {
  EXTERNAL_CONTROL_TOOLS,
  ExternalControlOverviewSchema,
  createEnvelope,
  isExternalControlSettingsCommand
} from "@deepwrite/contracts/external-control";
import type { CommandEnvelope } from "@deepwrite/contracts";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeClientConfigs } from "./client-configs";
import { testAppState } from "./external-control.test-support";
import { createExternalControl } from "./index";
import { createTrashStore } from "./trash-store";

let home: string;

function setup() {
  const control = createExternalControl({
    paths: {
      directory: join(home, "control"),
      stateFile: join(home, "control", "control.json"),
      endpoint: join(home, "c.sock")
    },
    app: testAppState({ dataDirectory: () => home }),
    homeDirectory: home,
    connection: () => ({
      command: "/Applications/Deep Write.app/DeepWrite",
      args: ["/example.test/bridge-entry.js"]
    }),
    sendWindowRequest: vi.fn(),
    confirmClient: () => Promise.resolve(true),
    warn: vi.fn()
  });
  const send = async (type: string, payload: Record<string, string> = {}) => {
    const result = await control.handleSettingsCommand(
      createEnvelope(type, payload, {
        id: "cmd_test"
      }) as unknown as CommandEnvelope
    );
    if (!result) throw new Error("not a settings command");
    return result;
  };
  return { control, send };
}

async function accepted(
  result: Awaited<ReturnType<ReturnType<typeof setup>["send"]>>
) {
  if (result.status !== "accepted") throw new Error(result.error.message);
  return ExternalControlOverviewSchema.parse(result.payload);
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "dw-settings-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("external control settings commands", () => {
  it("leaves every other command to the normal chain", async () => {
    const { control } = setup();
    await expect(
      control.handleSettingsCommand(
        createEnvelope(
          "system.ping",
          {},
          { id: "cmd_test" }
        ) as unknown as CommandEnvelope
      )
    ).resolves.toBeUndefined();
  });

  it("cannot be reached from a tool name", () => {
    expect(
      EXTERNAL_CONTROL_TOOLS.filter(({ name }) =>
        isExternalControlSettingsCommand(`externalControl.${name}`)
      )
    ).toEqual([]);
    expect(
      EXTERNAL_CONTROL_TOOLS.map(({ name }) => name).filter((name) =>
        /revoke|install|empty/u.test(name)
      )
    ).toEqual([]);
  });

  it("reports the skill as installed and keeps other skills untouched", async () => {
    const { send } = setup();
    const neighbour = join(home, ".claude", "skills", "other", "SKILL.md");
    await mkdir(join(home, ".claude", "skills", "other"), { recursive: true });
    await writeFile(neighbour, "mine", "utf8");
    const before = await accepted(await send("externalControl.overview"));
    expect(before.skillTargets.every(({ installed }) => !installed)).toBe(true);

    const after = await accepted(
      await send("externalControl.installSkill", { targetId: "claude" })
    );

    expect(
      after.skillTargets
        .filter(({ installed }) => installed)
        .map(({ id }) => id)
    ).toEqual(["claude"]);
    const directory = join(home, ".claude", "skills", "deepwrite");
    await expect(readdir(directory)).resolves.toEqual(["SKILL.md"]);
    await expect(
      readFile(join(directory, "SKILL.md"), "utf8")
    ).resolves.toMatch(/^---\nname: deepwrite\n/u);
    await expect(readFile(neighbour, "utf8")).resolves.toBe("mine");
  });

  it("rejects an install target that is not on the list", async () => {
    const { send } = setup();
    await expect(
      send("externalControl.installSkill", { targetId: "../evil" })
    ).resolves.toMatchObject({
      status: "rejected",
      error: { code: "external.invalid_input" }
    });
    await expect(readdir(home)).resolves.toEqual([]);
  });

  it("forgets a revoked client", async () => {
    const accessFile = join(home, "config", "external-control.json");
    await mkdir(join(home, "config"), { recursive: true });
    await writeFile(
      accessFile,
      JSON.stringify({
        version: 1,
        clients: [
          { name: "Codex", approvedAt: "2026-11-01T00:00:00.000Z" },
          { name: "Claude Code", approvedAt: "2026-11-01T00:00:00.000Z" }
        ]
      }),
      "utf8"
    );
    const { send } = setup();

    const { clients } = await accepted(
      await send("externalControl.revokeClient", { name: "Codex" })
    );

    expect(clients.map(({ name }) => name)).toEqual(["Claude Code"]);
    expect(JSON.parse(await readFile(accessFile, "utf8")).clients).toHaveLength(
      1
    );
  });

  it("empties the trash but never touches a project's folder", async () => {
    const projectDirectory = join(home, "my-book");
    await mkdir(projectDirectory);
    await writeFile(join(projectDirectory, "deepwrite.json"), "{}", "utf8");
    const trash = createTrashStore({
      directory: () => join(home, "external-trash")
    });
    await trash.save({
      kind: "project",
      title: "My book",
      client: "Codex",
      domain: "book",
      projectId: "book-1",
      projectDirectory
    });
    await trash.save({
      kind: "team",
      title: "Team",
      client: "Codex",
      workspaceType: "short",
      settings: {}
    });
    const { send } = setup();
    const before = await accepted(await send("externalControl.overview"));
    expect(before.trash).toHaveLength(2);
    expect(
      before.trash.find(({ kind }) => kind === "project")?.expiresAt
    ).toBeNull();
    expect(before.trash.find(({ kind }) => kind === "team")?.expiresAt).toEqual(
      expect.any(String)
    );

    const after = await accepted(await send("externalControl.emptyTrash"));

    expect(after.trash).toEqual([]);
    await expect(readdir(projectDirectory)).resolves.toEqual([
      "deepwrite.json"
    ]);
  });

  it("reports a restore of an unknown record", async () => {
    const { send } = setup();
    await expect(
      send("externalControl.restoreTrash", {
        trashId: "00000000-0000-4000-8000-000000000000"
      })
    ).resolves.toMatchObject({
      status: "rejected",
      error: { code: "external.not_found" }
    });
  });

  it("shows activity newest first without any targets", async () => {
    await mkdir(join(home, "logs"));
    await writeFile(
      join(home, "logs", "external-control.jsonl"),
      [
        {
          time: "t1",
          client: "Codex",
          tool: "list_works",
          target: {},
          result: "ok"
        },
        {
          time: "t2",
          client: "Codex",
          tool: "write_document",
          target: { workId: "secret-id" },
          result: "ok"
        }
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
      "utf8"
    );
    const { send } = setup();
    const { activity } = await accepted(await send("externalControl.overview"));
    expect(activity.map(({ tool }) => tool)).toEqual([
      "write_document",
      "list_works"
    ]);
    expect(JSON.stringify(activity)).not.toContain("secret-id");
  });
});

describe("client configs", () => {
  const configs = bridgeClientConfigs({
    command: 'C:\\Program Files\\Deep "Write"\\DeepWrite.exe',
    args: ["C:\\app.asar\\bridge-entry.js"]
  });
  const text = (id: string) =>
    configs.find((config) => config.id === id)?.text ?? "";

  it("quotes paths with spaces, quotes and backslashes for a shell", () => {
    expect(text("claude")).toBe(
      'claude mcp add --scope user deepwrite -e ELECTRON_RUN_AS_NODE=1 -- "C:\\\\Program Files\\\\Deep \\"Write\\"\\\\DeepWrite.exe" "C:\\\\app.asar\\\\bridge-entry.js"'
    );
    expect(text("codex")).toContain(
      "codex mcp add deepwrite --env ELECTRON_RUN_AS_NODE=1 -- "
    );
  });

  it("gives the generic client valid JSON with the exact command", () => {
    expect(JSON.parse(text("generic"))).toEqual({
      mcpServers: {
        deepwrite: {
          command: 'C:\\Program Files\\Deep "Write"\\DeepWrite.exe',
          args: ["C:\\app.asar\\bridge-entry.js"],
          env: { ELECTRON_RUN_AS_NODE: "1" }
        }
      }
    });
  });
});
