import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import type { BrowserWindow } from "electron";
import { expect, it } from "vitest";
import { ConversationDatabase } from "../utilities/conversation-storage/database";
import { runConversationSmoke } from "./smoke-conversation";

function windowFor(database: ConversationDatabase): BrowserWindow {
  const history = Object.fromEntries(
    [
      "commit",
      "stage",
      "session",
      "messages",
      "detail",
      "metadataDetail",
      "turns",
      "list",
      "mergeScopes"
    ].map((name) => {
      const method = database[name as keyof ConversationDatabase] as (
        value: unknown
      ) => unknown;
      return [name, async (input: unknown) => method.call(database, input)];
    })
  );
  return {
    webContents: {
      executeJavaScript: (script: string) =>
        runInNewContext(script, {
          TextEncoder,
          deepwrite: { conversationPersistence: { history } }
        })
    }
  } as unknown as BrowserWindow;
}

it("serializes a self-contained Renderer persistence probe and verifies a closed database on its second launch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deepwrite-smoke-fixture-"));
  const path = join(directory, "history.sqlite");
  let database = new ConversationDatabase(path);
  try {
    const first = await runConversationSmoke(windowFor(database));
    expect(first).toMatchObject({
      status: "ok",
      reopened: false,
      staged: true,
      unknownRetained: true,
      proposalRetained: true
    });
    expect(first.chunkPages).toBeGreaterThan(1);
    expect(first.metadataChunkPages).toBeGreaterThan(1);
    database.close();
    database = new ConversationDatabase(path);
    const reopened = await runConversationSmoke(windowFor(database));
    expect(reopened).toMatchObject({ ...first, reopened: true });
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
