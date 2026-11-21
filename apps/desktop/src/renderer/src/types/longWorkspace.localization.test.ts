import { afterEach, expect, it } from "vitest";
import { setAppLanguage } from "../i18n";
import {
  createLongChapterSelection,
  longCharacterGroupLabel
} from "./longWorkspace";
import { fixture } from "./longWorkspace.test-support";

afterEach(() => setAppLanguage("zh-CN", "zh-CN"));

it("updates cached chapter display labels without changing file identity or source content", () => {
  const { summary, workspaceIndex } = fixture(null);
  const source = JSON.stringify({ summary, workspaceIndex });
  const selection = createLongChapterSelection(
    summary,
    workspaceIndex,
    "chapter_one"
  )!;
  const file = selection.files.find(({ role }) => role === "body")!;
  const card = selection.files.find(({ role }) => role === "card")!;
  expect(card.label).toBe("章卡");
  const reference = file.file;
  expect(file.label).toBe("正文");
  setAppLanguage("en-US", "en-US");
  expect(file.label).toBe("Manuscript");
  expect(card.label).toBe("Chapter card");
  expect(selection.breadcrumbs).toContain("Manuscript");
  expect(selection.title).toBe("第一章");
  expect(file.file).toBe(reference);
  expect(JSON.stringify({ summary, workspaceIndex })).toBe(source);
  setAppLanguage("zh-CN", "zh-CN");
  expect(file.label).toBe("正文");
});

it("localizes builtin character types while preserving custom titles", () => {
  setAppLanguage("en-US", "en-US");
  expect(longCharacterGroupLabel("protagonist")).toBe("Protagonists");
  expect(
    longCharacterGroupLabel("protagonist", [
      { id: "protagonist", title: "我的主角组", order: 1 }
    ])
  ).toBe("我的主角组");
});

it("updates a cached empty character group without renaming the saved group", async () => {
  const { createLongCharacterGroupSelection } = await import("./longWorkspace");
  const { summary, workspaceIndex } = fixture(null);
  summary.navigation.characterTypes = [
    { id: "protagonist", title: "主角", order: 1 }
  ];
  workspaceIndex.characterTypes = summary.navigation.characterTypes;
  const selection = createLongCharacterGroupSelection(
    summary,
    workspaceIndex,
    "protagonist"
  )!;
  expect(selection.title).toBe("主角");
  setAppLanguage("en-US", "en-US");
  expect(selection.title).toBe("Protagonists");
  expect(selection.description).toContain("No Protagonists yet");
  expect(summary.navigation.characterTypes[0]?.title).toBe("主角");
});
