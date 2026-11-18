import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import {
  CommandEnvelopeSchema,
  MysteryExportBundleInputSchema,
  MysteryExportBundleResultSchema,
  MysteryOpenBookResultSchema,
  MysteryReadDocumentResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type MysteryDocumentTarget,
  type MysteryExportBundleInput,
  type MysteryExportBundleResult
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import type { BookImageExportLoader } from "./book-images/export-assets";
import {
  loadManuscriptImages,
  textWithImagePlaceholders
} from "./manuscript-export-images";
import { buildDocxDocument } from "./short-manuscript-docx";

export type MysteryBundleCoreClient = (
  command: CommandEnvelope
) => Promise<CommandResult>;

const WINDOWS_RESERVED_NAMES =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function safeSegment(value: string, fallback = "未命名"): string {
  const cleaned = Array.from(
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/[. ]+$/gu, "")
  )
    .slice(0, 80)
    .join("");
  if (!cleaned || WINDOWS_RESERVED_NAMES.test(cleaned)) return fallback;
  return cleaned;
}

function pad2(index: number): string {
  return String(index).padStart(2, "0");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function uniqueDirectory(basePath: string): Promise<string> {
  if (!(await pathExists(basePath))) return basePath;
  for (let index = 2; index < 100_000; index += 1) {
    const candidate = `${basePath} (${index})`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("导出目录存在过多同名文件夹，请更换导出位置。");
}

interface ExportSection {
  title: string;
  content: string;
}

function formatMarkdownFile(
  title: string,
  sections: readonly ExportSection[]
): Buffer {
  const parts = [`# ${title}`];
  for (const section of sections) {
    const body = textWithImagePlaceholders(section.content).trim();
    parts.push(body ? `## ${section.title}\n\n${body}` : `## ${section.title}`);
  }
  return Buffer.from(`${parts.join("\n\n")}\n`, "utf8");
}

async function callCore(
  core: MysteryBundleCoreClient,
  type: CommandEnvelope["type"],
  payload: unknown
): Promise<unknown> {
  const id = createId("cmd_mystery_export");
  const envelope = CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, {
      id,
      correlationId: id
    })
  );
  const result = await core(envelope);
  if (result.status === "rejected") {
    throw new Error(result.error.message);
  }
  return result.payload;
}

export async function exportMysteryBundle(
  window: BrowserWindow | undefined,
  rawInput: MysteryExportBundleInput,
  core: MysteryBundleCoreClient,
  loadImages?: BookImageExportLoader
): Promise<MysteryExportBundleResult> {
  const input = MysteryExportBundleInputSchema.parse(rawInput);

  let parentDirectory = input.targetDirectory;
  if (!parentDirectory) {
    const dialogOptions = {
      title: "选择剧本杀开本包导出目录",
      properties: ["openDirectory", "createDirectory"] as (
        "openDirectory" | "createDirectory"
      )[]
    };
    const selection = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (selection.canceled || selection.filePaths.length === 0) {
      return MysteryExportBundleResultSchema.parse({ status: "cancelled" });
    }
    parentDirectory = selection.filePaths[0]!;
  }

  const opened = MysteryOpenBookResultSchema.parse(
    await callCore(core, "mystery.open", { bookId: input.bookId })
  );
  const { book } = opened;
  const sortedTruthDocs = [...book.truthDocuments].sort(
    (a, b) => a.order - b.order
  );
  const sortedRoles = [...book.roles].sort((a, b) => a.order - b.order);
  const sortedActs = [...book.acts].sort((a, b) => a.order - b.order);
  const sortedClues = [...book.clueRounds].sort((a, b) => a.order - b.order);

  const readDoc = async (target: MysteryDocumentTarget): Promise<string> => {
    const res = MysteryReadDocumentResultSchema.parse(
      await callCore(core, "mystery.readDocument", {
        bookId: book.id,
        target
      })
    );
    return res.content;
  };

  // Assemble strictly separated files: player outputs read ONLY .pitch.md, .body.md,
  // public_openings.md, and clues/*.md — never truth/, .profile.md, .brief.md, endings, or dm/.
  const files: Array<{
    relPath: string;
    title: string;
    sections: ExportSection[];
  }> = [];

  // 00-DM主持与真相手册
  const dmSections: ExportSection[] = [];
  for (const doc of sortedTruthDocs) {
    dmSections.push({
      title: doc.title,
      content: await readDoc({ kind: "truth_doc", docId: doc.id })
    });
  }
  dmSections.push({
    title: "NPC 与人物关系网",
    content: await readDoc({ kind: "character_relations" })
  });
  for (const role of sortedRoles) {
    dmSections.push({
      title: `${role.name}${role.tag ? `（${role.tag}）` : ""} · 上帝底牌`,
      content: await readDoc({
        kind: "role",
        roleId: role.id,
        document: "profile"
      })
    });
  }
  dmSections.push({
    title: "多分支结局",
    content: await readDoc({ kind: "public_doc", docId: "endings" })
  });
  dmSections.push({
    title: "DM 主持手册",
    content: await readDoc({ kind: "dm_manual" })
  });
  files.push({
    relPath: `00-DM主持与真相手册.${input.format}`,
    title: `${book.title} · DM 主持与真相手册`,
    sections: dmSections
  });

  // 01-玩家选角简介（无剧透）
  const personLabel =
    book.boardSpec.narrativePerson === "second"
      ? "第二人称（你）"
      : "第一人称（我）";
  const castingSections: ExportSection[] = [
    {
      title: "剧本盘面简介",
      content: [
        `题材：${book.genre}`,
        `玩家配置：${book.boardSpec.playerCount} 人 · ${sortedActs.length} 幕`,
        `叙事人称：${personLabel}`,
        book.boardSpec.summary.trim()
      ]
        .filter(Boolean)
        .join("\n\n")
    }
  ];
  for (const [index, role] of sortedRoles.entries()) {
    castingSections.push({
      title: `${index + 1}. ${role.name}${role.tag ? `（${role.tag}）` : ""}`,
      content: await readDoc({
        kind: "role",
        roleId: role.id,
        document: "pitch"
      })
    });
  }
  files.push({
    relPath: `01-玩家选角简介（无剧透）.${input.format}`,
    title: `${book.title} · 玩家选角简介`,
    sections: castingSections
  });

  // 02-玩家人物本（严格仅读 body.md）
  for (const [rIndex, role] of sortedRoles.entries()) {
    const roleFolder = `${pad2(rIndex + 1)}-${safeSegment(role.name, `角色${rIndex + 1}`)}`;
    if (input.playerScriptLayout === "by-role") {
      const actSections: ExportSection[] = [];
      for (const act of sortedActs) {
        actSections.push({
          title: act.title,
          content: await readDoc({
            kind: "player_act",
            roleId: role.id,
            actId: act.id,
            document: "body"
          })
        });
      }
      files.push({
        relPath: join("02-玩家人物本", `${roleFolder}.${input.format}`),
        title: `${book.title} · ${role.name}`,
        sections: actSections
      });
    } else {
      for (const [aIndex, act] of sortedActs.entries()) {
        const actContent = await readDoc({
          kind: "player_act",
          roleId: role.id,
          actId: act.id,
          document: "body"
        });
        const actName = `${pad2(aIndex + 1)}-${safeSegment(act.title, `第${aIndex + 1}幕`)}.${input.format}`;
        files.push({
          relPath: join("02-玩家人物本", roleFolder, actName),
          title: `${book.title} · ${role.name} · ${act.title}`,
          sections: [{ title: act.title, content: actContent }]
        });
      }
    }
  }

  // 03-搜证线索与公共物料
  const openings = await readDoc({
    kind: "public_doc",
    docId: "public_openings"
  });
  files.push({
    relPath: join("03-搜证线索与公共物料", `00-公共序幕与开场.${input.format}`),
    title: `${book.title} · 公共序幕与开场`,
    sections: [{ title: "公共序幕与地图", content: openings }]
  });
  for (const [cIndex, round] of sortedClues.entries()) {
    const roundContent = await readDoc({
      kind: "clue_round",
      roundId: round.id
    });
    const roundName = `${pad2(cIndex + 1)}-${safeSegment(round.title, `线索${cIndex + 1}`)}.${input.format}`;
    files.push({
      relPath: join("03-搜证线索与公共物料", roundName),
      title: `${book.title} · ${round.title}`,
      sections: [{ title: round.title, content: roundContent }]
    });
  }

  const bundleDirectory = await uniqueDirectory(
    join(parentDirectory, `${safeSegment(book.title, "剧本杀")}-开本包`)
  );
  await mkdir(bundleDirectory, { recursive: true });

  let missingImages = 0;
  for (const file of files) {
    const destPath = join(bundleDirectory, file.relPath);
    await mkdir(dirname(destPath), { recursive: true });
    let bytes: Buffer;
    if (input.format === "docx") {
      // Load images scoped strictly to THIS file so DM assets cannot leak into player DOCX archives.
      const loaded = await loadManuscriptImages(
        { projectType: "mystery", projectId: book.id },
        file.sections.map((section) => section.content),
        loadImages
      );
      missingImages += loaded.missingImages;
      bytes = buildDocxDocument(file.title, file.sections, loaded.assets);
    } else {
      bytes = formatMarkdownFile(file.title, file.sections);
    }
    await writeFile(destPath, bytes);
  }

  return MysteryExportBundleResultSchema.parse({
    status: "saved",
    bundleDirectory,
    fileCount: files.length,
    missingImages
  });
}
