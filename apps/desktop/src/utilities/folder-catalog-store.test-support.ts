import {
  access,
  chmod,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CatalogSnapshotSchema,
  CreativeBookSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createShortWorkspaceContentRevision,
  type CatalogSnapshot,
  type CreativeBook
} from "@deepwrite/contracts";
import {
  assertLegacyBookMigrationSourcesUnchanged,
  FolderCatalogConflictError,
  FolderCatalogStore
} from "./folder-catalog-store";

const temporaryRoots = new Set<string>();
const timestamp = "2026-07-19T01:02:03.000Z";

async function makeTemporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function tickingClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 19, 10, 0, tick++)).toISOString();
}

function catalogFixture(): Omit<CatalogSnapshot, "books"> & {
  books: CreativeBook[];
} {
  return CatalogSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 17,
    updatedAt: timestamp,
    legacyImport: {
      sourceRoot: "/legacy/source",
      fingerprint: "a".repeat(64),
      importedAt: timestamp,
      materials: 1,
      skills: 1,
      materialGroups: 1,
      skillGroups: 1
    },
    books: [
      {
        id: "book-existing",
        title: "雨夜/来信",
        bookType: "short",
        genre: "悬疑",
        status: "editing",
        linkedMaterialIdsByKind: {
          character: ["material-existing"],
          gimmick: [],
          plot: [],
          draft: [],
          other: []
        },
        linkedSkillIdsByKind: {
          general: ["skill-existing"],
          plot: [],
          style: [],
          other: []
        },
        documents: [
          {
            id: "draft",
            title: "正文编写",
            content: "# 第一章\n\n门外一直在下雨。",
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    materials: [
      {
        id: "material-existing",
        title: "人物素材",
        materialType: "short",
        materialKind: "character",
        parentGenre: "悬疑",
        subGenre: "",
        overview: "人物备忘",
        entries: [
          {
            id: "material-entry",
            stageId: "character",
            title: "守夜人",
            body: "守夜人从不在白天出现。",
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    materialGroups: [
      {
        id: "material-group-existing",
        title: "悬疑素材组",
        members: { character: "material-existing" },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    skills: [
      {
        id: "skill-existing",
        title: "通用写作技能",
        skillType: "short",
        skillKind: "general",
        overview: "",
        isBuiltin: false,
        entries: [
          {
            id: "skill-entry",
            stageId: "draft",
            title: "正文技能",
            body: "保持短句和悬念。",
            createdAt: timestamp,
            updatedAt: timestamp,
            sourceSkillId: "source-skill"
          }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    skillGroups: [
      {
        id: "skill-group-existing",
        title: "悬疑技能组",
        members: { general: "skill-existing" },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  }) as Omit<CatalogSnapshot, "books"> & { books: CreativeBook[] };
}

function asCreativeBook(book: unknown): CreativeBook {
  return CreativeBookSchema.parse(book);
}

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
  temporaryRoots.clear();
});

export {
  CatalogSnapshotSchema,
  FolderCatalogConflictError,
  FolderCatalogStore,
  access,
  afterEach,
  asCreativeBook,
  assertLegacyBookMigrationSourcesUnchanged,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  catalogFixture,
  chmod,
  cp,
  createShortWorkspaceContentRevision,
  describe,
  dirname,
  expect,
  it,
  join,
  link,
  makeTemporaryRoot,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  temporaryRoots,
  tickingClock,
  timestamp,
  tmpdir,
  utimes,
  writeFile,
  writeJson
};
export type { CatalogSnapshot };
