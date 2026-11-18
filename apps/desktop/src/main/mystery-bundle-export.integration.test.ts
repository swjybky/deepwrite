import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MysteryWorkspaceService,
  handleMysteryCoreCommand
} from "../utilities/mystery-store";
import { exportMysteryBundle } from "./mystery-bundle-export";

vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn() }
}));

const tempDirs: string[] = [];

async function makeTempDir(
  prefix = "deepwrite-mystery-bundle-"
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

/** Reads raw UTF-8 text from an uncompressed (STORE) DOCX zip buffer. */
function extractDocxXmlText(zip: Buffer): string {
  return zip.toString("utf8");
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe("exportMysteryBundle", () => {
  it("isolates truth/profile/brief/endings/dm secrets from player .md and .docx files", async () => {
    const userDataPath = await makeTempDir("deepwrite-mys-exp-user-");
    const booksParent = await makeTempDir("deepwrite-mys-exp-books-");
    const exportDir = await makeTempDir("deepwrite-mys-exp-out-");
    const service = new MysteryWorkspaceService({ userDataPath });

    const created = await service.createAtPath(booksParent, {
      title: "孤岛钟声",
      genre: "硬核推理",
      boardSpec: {
        playerCount: 2,
        actCountTarget: 2,
        narrativePerson: "second",
        summary: "暴风雪孤岛七人聚会。"
      }
    });
    const [roleA, roleB] = created.book.roles;
    const [act1, act2] = created.book.acts;

    const SENTINEL_TRUTH = "SECRET_SENTINEL_CORE_TRUTH_991";
    const SENTINEL_PROFILE = "SECRET_SENTINEL_ROLE_PROFILE_992";
    const SENTINEL_BRIEF = "SECRET_SENTINEL_ACT_BRIEF_993";
    const SENTINEL_ENDINGS = "SECRET_SENTINEL_ENDINGS_994";
    const SENTINEL_DM = "SECRET_SENTINEL_DM_MANUAL_995";
    const PUBLIC_PITCH = "PLAYER_PUBLIC_CASTING_PITCH_A";
    const PLAYER_BODY_1 = "你听见走廊尽头的怀表滴答作响。BODY_PART_1";
    const PLAYER_BODY_2 = "你掀开壁画后的机关暗格。BODY_PART_2";
    const CLUE_PUBLIC = "CLUE_ROUND_1_CLOCK_GEAR";

    await service.writeDocument({
      bookId: created.book.id,
      target: { kind: "truth_doc", docId: "core_truth" },
      content: `真凶用齿轮冰块制造延迟不在场证明：${SENTINEL_TRUTH}`
    });
    await service.writeDocument({
      bookId: created.book.id,
      target: { kind: "role", roleId: roleA!.id, document: "profile" },
      content: `上帝底牌：角色A其实是幕后策划者 ${SENTINEL_PROFILE}`
    });
    await service.writeDocument({
      bookId: created.book.id,
      target: { kind: "role", roleId: roleA!.id, document: "pitch" },
      content: `冷静寡言的钟表匠：${PUBLIC_PITCH}`
    });
    await service.writeDocument({
      bookId: created.book.id,
      target: {
        kind: "player_act",
        roleId: roleA!.id,
        actId: act1!.id,
        document: "brief"
      },
      content: `任务卡禁区：不得透露你偷藏了钥匙 ${SENTINEL_BRIEF}`
    });
    await service.writeDocument({
      bookId: created.book.id,
      target: {
        kind: "player_act",
        roleId: roleA!.id,
        actId: act1!.id,
        document: "body"
      },
      content: PLAYER_BODY_1
    });
    await service.writeDocument({
      bookId: created.book.id,
      target: {
        kind: "player_act",
        roleId: roleA!.id,
        actId: act2!.id,
        document: "body"
      },
      content: PLAYER_BODY_2
    });
    await service.writeDocument({
      bookId: created.book.id,
      target: { kind: "public_doc", docId: "endings" },
      content: `真相结局复盘：${SENTINEL_ENDINGS}`
    });
    await service.writeDocument({
      bookId: created.book.id,
      target: { kind: "dm_manual" },
      content: `DM 控场扶车台词：${SENTINEL_DM}`
    });
    await service.writeDocument({
      bookId: created.book.id,
      target: { kind: "clue_round", roundId: created.book.clueRounds[0]!.id },
      content: `带血的黄铜齿轮：${CLUE_PUBLIC}`
    });
    await service.applyOperations({
      bookId: created.book.id,
      batch: {
        operations: [
          {
            type: "clueRound.create",
            round: {
              id: "round_extra",
              title: "额外深搜阶段",
              content: "时钟底座的刻痕。"
            }
          }
        ],
        documentWrites: []
      }
    });

    const core = async (
      command: Parameters<typeof handleMysteryCoreCommand>[1]
    ) => {
      const res = await handleMysteryCoreCommand(service, command);
      if (!res) throw new Error(`Unsupported command: ${command.type}`);
      return res;
    };

    // 1. Cancelled dialog
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: true,
      filePaths: []
    });
    const cancelled = await exportMysteryBundle(
      {} as BrowserWindow,
      { bookId: created.book.id, format: "md", playerScriptLayout: "by-role" },
      core
    );
    expect(cancelled).toEqual({ status: "cancelled" });

    // 2. Markdown export (by-role)
    const mdResult = await exportMysteryBundle(
      undefined,
      {
        bookId: created.book.id,
        targetDirectory: exportDir,
        format: "md",
        playerScriptLayout: "by-role"
      },
      core
    );
    expect(mdResult.status).toBe("saved");
    if (mdResult.status !== "saved") throw new Error("Expected saved");

    const mdDm = await readFile(
      join(mdResult.bundleDirectory, "00-DM主持与真相手册.md"),
      "utf8"
    );
    expect(mdDm).toContain(SENTINEL_TRUTH);
    expect(mdDm).toContain(SENTINEL_PROFILE);
    expect(mdDm).toContain(SENTINEL_ENDINGS);
    expect(mdDm).toContain(SENTINEL_DM);

    const mdPitch = await readFile(
      join(mdResult.bundleDirectory, "01-玩家选角简介（无剧透）.md"),
      "utf8"
    );
    expect(mdPitch).toContain(PUBLIC_PITCH);

    const mdPlayerFiles = await listFilesRecursive(
      join(mdResult.bundleDirectory, "02-玩家人物本")
    );
    expect(mdPlayerFiles).toHaveLength(2);
    const mdPlayerTexts = await Promise.all(
      mdPlayerFiles.map((file) => readFile(file, "utf8"))
    );
    expect(mdPlayerTexts.join("\n")).toContain(PLAYER_BODY_1);
    expect(mdPlayerTexts.join("\n")).toContain(PLAYER_BODY_2);

    const mdClueFiles = await listFilesRecursive(
      join(mdResult.bundleDirectory, "03-搜证线索与公共物料")
    );
    const mdClueTexts = await Promise.all(
      mdClueFiles.map((file) => readFile(file, "utf8"))
    );
    expect(mdClueTexts.join("\n")).toContain(CLUE_PUBLIC);

    for (const secret of [
      SENTINEL_TRUTH,
      SENTINEL_PROFILE,
      SENTINEL_BRIEF,
      SENTINEL_ENDINGS,
      SENTINEL_DM
    ]) {
      expect(mdPitch).not.toContain(secret);
      for (const playerText of mdPlayerTexts) {
        expect(playerText).not.toContain(secret);
      }
      for (const clueText of mdClueTexts) {
        expect(clueText).not.toContain(secret);
      }
    }
    expect(roleB).toBeDefined();

    // 3. DOCX export (by-role-act)
    const docxResult = await exportMysteryBundle(
      undefined,
      {
        bookId: created.book.id,
        targetDirectory: exportDir,
        format: "docx",
        playerScriptLayout: "by-role-act"
      },
      core
    );
    expect(docxResult.status).toBe("saved");
    if (docxResult.status !== "saved") throw new Error("Expected saved");

    const docxPlayerFiles = await listFilesRecursive(
      join(docxResult.bundleDirectory, "02-玩家人物本")
    );
    expect(docxPlayerFiles).toHaveLength(4); // 2 roles × 2 acts
    const docxPlayerXml = await Promise.all(
      docxPlayerFiles.map(async (file) =>
        extractDocxXmlText(await readFile(file))
      )
    );
    expect(docxPlayerXml.join("\n")).toContain("BODY_PART_1");
    expect(docxPlayerXml.join("\n")).toContain("BODY_PART_2");

    const docxPitchXml = extractDocxXmlText(
      await readFile(
        join(docxResult.bundleDirectory, "01-玩家选角简介（无剧透）.docx")
      )
    );
    expect(docxPitchXml).toContain(PUBLIC_PITCH);

    for (const secret of [
      SENTINEL_TRUTH,
      SENTINEL_PROFILE,
      SENTINEL_BRIEF,
      SENTINEL_ENDINGS,
      SENTINEL_DM
    ]) {
      expect(docxPitchXml).not.toContain(secret);
      for (const xml of docxPlayerXml) {
        expect(xml).not.toContain(secret);
      }
    }
  });
});
