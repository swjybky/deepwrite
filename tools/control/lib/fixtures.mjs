import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./output.mjs";
import { assertInsideTestEnvironment } from "./paths.mjs";

export const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures"
);

export async function listFixtures(directory = FIXTURES_DIR) {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const fixtures = [];
  for (const file of names) {
    const fixture = JSON.parse(await readFile(join(directory, file), "utf8"));
    fixtures.push({ name: basename(file, ".json"), ...fixture });
  }
  return fixtures;
}

export async function findFixtures(names, directory = FIXTURES_DIR) {
  const all = await listFixtures(directory);
  const wanted = names
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = wanted.filter((name) => !all.some((f) => f.name === name));
  if (wanted.length === 0 || unknown.length > 0) {
    throw new CliError(
      "data.unknown_fixture",
      unknown.length > 0
        ? `没有数据集：${unknown.join(", ")}`
        : "没有指定数据集。",
      {
        nextSteps: ["运行 pnpm -s ctl data fixtures 查看可用数据集"],
        details: { fixtures: all.map(({ name }) => name) }
      }
    );
  }
  return wanted.map((name) => all.find((fixture) => fixture.name === name));
}

export function outline(fixture) {
  return {
    name: fixture.name,
    summary: fixture.summary,
    works: fixture.works.map(({ type, title, documents, sections }) => ({
      type,
      title,
      documents: Object.keys(documents),
      newSections: sections.map(({ title: section }) => section)
    })),
    libraries: fixture.libraries.map(({ domain, kind, title, entries }) => ({
      domain,
      kind,
      title,
      entries: entries.map(({ title: entry }) => entry)
    }))
  };
}

const ledgerFile = (layout) => join(layout.root, "fixtures.json");

/** What `data load` created, so `data clear --loaded` can remove exactly that. */
export async function readLedger(layout) {
  try {
    return JSON.parse(await readFile(ledgerFile(layout), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { items: [] };
    throw error;
  }
}

export async function writeLedger(layout, ledger) {
  const target = assertInsideTestEnvironment(layout, ledgerFile(layout));
  await mkdir(layout.root, { recursive: true });
  await writeFile(`${target}.tmp`, `${JSON.stringify(ledger, null, 2)}\n`);
  await rename(`${target}.tmp`, target);
}

function driftError(fixture, work, title, documents) {
  return new CliError(
    "data.fixture_outdated",
    `数据集 ${fixture.name} 的「${work.title}」里找不到文档「${title}」，作品结构可能改过。`,
    {
      nextSteps: [
        `按 details.documents 更新 tools/control/fixtures/${fixture.name}.json 的文档标题`,
        "已建好的部分记在台账里，可用 pnpm -s ctl data clear --loaded 清掉"
      ],
      details: { documents: documents.map(({ title: name }) => name) }
    }
  );
}

async function writeDocument(session, workId, documentId, content) {
  const { revision } = await session.call("read_document", {
    workId,
    documentId
  });
  await session.call("write_document", {
    workId,
    documentId,
    content,
    baseRevision: revision
  });
}

async function loadWork(session, fixture, work, record) {
  const created = await session.call("manage_work", {
    action: "create",
    type: work.type,
    title: work.title,
    ...(work.genre ? { genre: work.genre } : {})
  });
  await record({ kind: "work", id: created.id, title: work.title });
  const { documents } = await session.call("get_work", { workId: created.id });
  for (const [title, content] of Object.entries(work.documents)) {
    const document = documents.find((candidate) => candidate.title === title);
    if (!document) throw driftError(fixture, work, title, documents);
    await writeDocument(session, created.id, document.id, content);
  }
  let after = documents
    .filter(({ group, id }) => group === "draft" && id.endsWith(":body"))
    .at(-1)?.id;
  for (const section of work.sections) {
    const added = await session.call("manage_document", {
      action: "create",
      workId: created.id,
      title: section.title,
      ...(after ? { documentId: after } : {})
    });
    await writeDocument(session, created.id, added.id, section.body);
    after = added.id;
  }
  return {
    kind: "work",
    id: created.id,
    title: work.title,
    documents: Object.keys(work.documents).length + work.sections.length
  };
}

async function loadLibrary(session, library, record) {
  const created = await session.call("manage_library", {
    action: "create",
    domain: library.domain,
    kind: library.kind,
    title: library.title
  });
  await record({ kind: "library", id: created.id, title: library.title });
  for (const entry of library.entries) {
    await session.call("manage_entry", {
      action: "create",
      libraryId: created.id,
      title: entry.title,
      content: entry.content
    });
  }
  return {
    kind: "library",
    id: created.id,
    title: library.title,
    entries: library.entries.length
  };
}

/** Goes through the control tools, so Core stays the only writer. */
export async function loadFixture(layout, session, fixture) {
  const record = async (item) => {
    const ledger = await readLedger(layout);
    ledger.items.push({
      ...item,
      fixture: fixture.name,
      loadedAt: new Date().toISOString()
    });
    await writeLedger(layout, ledger);
  };
  const loaded = [];
  for (const work of fixture.works) {
    loaded.push(await loadWork(session, fixture, work, record));
  }
  for (const library of fixture.libraries) {
    loaded.push(await loadLibrary(session, library, record));
  }
  return loaded;
}
