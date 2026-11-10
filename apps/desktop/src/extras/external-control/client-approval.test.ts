import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClientApproval } from "./client-approval";
import { createTestPaths } from "./external-control.test-support";

const CLIENT = { name: "codex-mcp-client" };

describe("client approval", () => {
  let accessFile: string;
  let cleanup: () => Promise<void>;
  const confirm = vi.fn<(client: { name: string }) => Promise<boolean>>();

  const approval = (waitMs?: number) =>
    createClientApproval({
      accessFile: () => accessFile,
      confirm,
      now: () => "2026-10-31T00:00:00.000Z",
      ...(waitMs === undefined ? {} : { waitMs })
    });

  beforeEach(async () => {
    confirm.mockReset();
    const created = await createTestPaths();
    cleanup = created.cleanup;
    accessFile = join(created.paths.directory, "external-control.json");
  });

  afterEach(() => cleanup());

  it("asks once and remembers across restarts", async () => {
    confirm.mockResolvedValue(true);
    await approval().authorize(CLIENT);
    await approval().authorize(CLIENT);
    expect(confirm).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(accessFile, "utf8"))).toEqual({
      version: 1,
      clients: [
        { name: "codex-mcp-client", approvedAt: "2026-10-31T00:00:00.000Z" }
      ]
    });
  });

  it("asks separately for each client", async () => {
    confirm.mockResolvedValue(true);
    const gate = approval();
    await gate.authorize(CLIENT);
    await gate.authorize({ name: "claude-code" });
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("observes another instance's revocation and preserves concurrently approved clients", async () => {
    confirm.mockResolvedValue(true);
    const formal = approval();
    const development = approval();
    await Promise.all([
      formal.authorize(CLIENT),
      development.authorize({ name: "other-test-client" })
    ]);
    expect((await formal.list()).map((client) => client.name).sort()).toEqual([
      "codex-mcp-client",
      "other-test-client"
    ]);
    await development.revoke(CLIENT.name);
    expect((await formal.list()).map((client) => client.name)).toEqual([
      "other-test-client"
    ]);
    await formal.authorize(CLIENT);
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("shows one dialog to clients connecting at the same time", async () => {
    let answer = (_allowed: boolean): void => undefined;
    confirm.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const gate = approval();
    const both = Promise.all([gate.authorize(CLIENT), gate.authorize(CLIENT)]);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    answer(true);
    await both;
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("refuses a denied client without asking again", async () => {
    confirm.mockResolvedValue(false);
    const gate = approval();
    await expect(gate.authorize(CLIENT)).rejects.toMatchObject({
      code: "external.unauthorized"
    });
    await expect(gate.authorize(CLIENT)).rejects.toMatchObject({
      code: "external.unauthorized"
    });
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("asks again after the switch is cycled", async () => {
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const gate = approval();
    await expect(gate.authorize(CLIENT)).rejects.toBeDefined();
    gate.reset();
    await expect(gate.authorize(CLIENT)).resolves.toBeUndefined();
  });

  it("does not persist a refusal", async () => {
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(approval().authorize(CLIENT)).rejects.toBeDefined();
    await expect(approval().authorize(CLIENT)).resolves.toBeUndefined();
  });

  it("reports a pending dialog and honors the answer on the next try", async () => {
    let answer = (_allowed: boolean): void => undefined;
    confirm.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const gate = approval(10);
    await expect(gate.authorize(CLIENT)).rejects.toMatchObject({
      code: "external.approval_pending"
    });
    answer(true);
    await vi.waitFor(() => gate.authorize(CLIENT));
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("treats a damaged access file as nothing approved", async () => {
    await mkdir(dirname(accessFile), { recursive: true });
    await writeFile(accessFile, "not json");
    confirm.mockResolvedValue(true);
    await approval().authorize(CLIENT);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("ignores a file with an unexpected shape", async () => {
    await mkdir(dirname(accessFile), { recursive: true });
    await writeFile(accessFile, JSON.stringify({ version: 9, clients: "all" }));
    confirm.mockResolvedValue(false);
    await expect(approval().authorize(CLIENT)).rejects.toBeDefined();
    expect(confirm).toHaveBeenCalledOnce();
  });
});
