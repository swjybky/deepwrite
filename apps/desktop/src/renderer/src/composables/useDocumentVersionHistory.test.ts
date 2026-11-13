import type {
  DocumentVersionSummary,
  DocumentVersionsApi,
  RestoreDocumentVersionResult
} from "@deepwrite/contracts";
import { effectScope, reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDocumentVersionHistory } from "./useDocumentVersionHistory";
import { uiMessage } from "../ui-feedback";

function version(seq: number, content = `内容${seq}`): DocumentVersionSummary {
  return {
    id: `v${seq}-${String(seq).padStart(8, "0")}`,
    seq,
    kind: "pre_conversation",
    createdAt: "2026-11-11T12:00:00.000Z",
    updatedAt: "2026-11-11T12:00:00.000Z",
    sha256: String(seq).repeat(64),
    charCount: content.length
  };
}
function setup() {
  const records = [version(3), version(2), version(1)];
  const state = reactive({
    busy: false,
    readOnly: false,
    unsaved: false,
    autoSave: true,
    content: "当前正文",
    sha: "4".repeat(64)
  });
  const restored = vi.fn();
  const close = vi.fn();
  const prepare = vi.fn(async () => true);
  const api: DocumentVersionsApi = {
    list: vi.fn(async () => ({
      versions: records,
      current: { sha256: state.sha, charCount: state.content.length }
    })),
    read: vi.fn(async ({ versionId }) => ({
      version: records.find(({ id }) => id === versionId)!,
      content: `内容${records.find(({ id }) => id === versionId)!.seq}`
    })),
    restore: vi.fn(
      async () =>
        ({
          workspace: "catalog",
          version: { ...version(4), kind: "restore", restoredFromSeq: 1 },
          current: { sha256: "1".repeat(64), charCount: 3 },
          document: {
            id: "doc",
            title: "第一章",
            content: "内容1",
            createdAt: "2026-11-11T12:00:00.000Z",
            updatedAt: "2026-11-11T12:01:00.000Z",
            projectRevision: 5
          }
        }) satisfies RestoreDocumentVersionResult
    )
  };
  const scope = effectScope();
  const history = scope.run(() =>
    useDocumentVersionHistory({
      target: () => ({
        workspace: "catalog",
        bookId: "book",
        documentId: "doc"
      }),
      content: () => state.content,
      busy: () => state.busy,
      restoreDisabledReason: () => (state.readOnly ? "只读内容" : ""),
      unsaved: () => state.unsaved,
      autoSave: () => state.autoSave,
      prepareRestore: prepare,
      restored,
      close,
      api: () => api
    })
  )!;
  return { history, state, records, api, restored, close, prepare, scope };
}

afterEach(() => vi.restoreAllMocks());

describe("document version history", () => {
  it("does not compare current content with empty text when no versions exist", async () => {
    const test = setup();
    test.records.length = 0;
    test.state.content = "第一段\n插入的一行\n后面的正文保持原样";
    await test.history.refresh();
    expect(test.api.read).not.toHaveBeenCalled();
    expect(test.history.displayedContent.value).toBe(test.state.content);
    expect(test.history.diff.value).toMatchObject({
      additions: 0,
      deletions: 0,
      hunks: []
    });
    test.scope.stop();
  });

  it("does not mark the whole document as added while its baseline is loading or unavailable", async () => {
    const test = setup();
    let fail!: (cause: unknown) => void;
    vi.mocked(test.api.read).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const refresh = test.history.refresh();
    await Promise.resolve();
    expect(test.history.loading.value).toBe(true);
    expect(test.history.diff.value.hunks).toEqual([]);
    fail({ code: "version.unavailable", message: "Missing version" });
    await refresh;
    expect(test.history.loading.value).toBe(false);
    expect(test.history.diff.value.hunks).toEqual([]);
    test.scope.stop();
  });

  it.each(["current", "historical"] as const)(
    "aligns unchanged paragraphs after inserting a line in %s content",
    async (selection) => {
      const test = setup();
      const before = "开头\n\n第一段\n\n第二段\n\n结尾";
      const after = "开头\n\n第一段\n插入的一行\n\n第二段\n\n结尾";
      test.state.content = after;
      vi.mocked(test.api.read).mockImplementation(async ({ versionId }) => ({
        version: test.records.find(({ id }) => id === versionId)!,
        content:
          selection === "historical" && versionId === version(2).id
            ? after
            : before
      }));
      await test.history.refresh();
      if (selection === "historical") await test.history.select(version(2).id);
      expect(test.history.diff.value).toMatchObject({
        additions: 1,
        deletions: 0,
        truncated: false
      });
      const lines = test.history.diff.value.hunks.flatMap(({ lines }) => lines);
      expect(lines.filter(({ type }) => type !== "context")).toEqual([
        { type: "addition", text: "插入的一行", newLineNumber: 4 }
      ]);
      expect(lines).toContainEqual({
        type: "context",
        text: "第二段",
        oldLineNumber: 5,
        newLineNumber: 6
      });
      test.scope.stop();
    }
  );

  it("does not mark an empty file with no history as unversioned", async () => {
    const test = setup();
    test.records.length = 0;
    test.state.content = "";
    await test.history.refresh();
    expect(test.history.currentChanged.value).toBe(false);
    test.state.content = "新内容";
    await test.history.refresh();
    expect(test.history.currentChanged.value).toBe(true);
    test.scope.stop();
  });

  it("disables restoration of any historical version matching disk content", async () => {
    const test = setup();
    test.state.sha = version(1).sha256;
    await test.history.refresh();
    await test.history.select(version(1).id);
    expect(test.history.canRestore.value).toBe(false);
    test.scope.stop();
  });

  it("blocks restoration during a run or with unsaved manual edits", async () => {
    const { history, state, api, scope } = setup();
    await history.refresh();
    await history.select(version(1).id);
    state.busy = true;
    expect(history.canRestore.value).toBe(false);
    expect(history.blockedReason.value).not.toBe("");
    await history.restore();
    expect(api.restore).not.toHaveBeenCalled();
    state.busy = false;
    state.readOnly = true;
    expect(history.canRestore.value).toBe(false);
    expect(history.blockedReason.value).toBe("只读内容");
    await history.restore();
    expect(api.restore).not.toHaveBeenCalled();
    state.readOnly = false;
    state.unsaved = true;
    state.autoSave = false;
    expect(history.canRestore.value).toBe(false);
    await history.restore();
    expect(api.restore).not.toHaveBeenCalled();
    scope.stop();
  });

  it.each([
    "version.unavailable",
    "version.busy",
    "version.disabled",
    "version.conflict"
  ])("handles %s as a structured failure", async (code) => {
    const test = setup();
    const error = vi.spyOn(uiMessage, "error");
    const info = vi.spyOn(uiMessage, "info");
    await test.history.refresh();
    await test.history.select(version(1).id);
    vi.mocked(test.api.restore).mockRejectedValue({
      code,
      message: "diagnostic",
      retryable: false
    });
    await test.history.restore();
    expect(test.restored).not.toHaveBeenCalled();
    if (code === "version.disabled") expect(test.close).toHaveBeenCalledOnce();
    else if (code === "version.unavailable")
      expect(error).toHaveBeenCalledOnce();
    else expect(info).toHaveBeenCalledOnce();
    expect(test.api.list).toHaveBeenCalledTimes(
      code === "version.conflict" ? 2 : 1
    );
    test.scope.stop();
  });

  it("lists newest first with current content, and reads only selected and adjacent versions", async () => {
    const test = setup();
    test.records.reverse();
    await test.history.refresh();
    expect(test.history.versions.value.map(({ seq }) => seq)).toEqual([
      3, 2, 1
    ]);
    expect(test.history.selectedId.value).toBeNull();
    expect(test.history.currentChanged.value).toBe(true);
    expect(test.history.displayedContent.value).toBe("当前正文");
    expect(test.api.read).toHaveBeenCalledTimes(1);
    vi.mocked(test.api.read).mockClear();
    await test.history.select(version(2).id);
    expect(
      vi.mocked(test.api.read).mock.calls.map(([input]) => input.versionId)
    ).toEqual([version(2).id, version(1).id]);
    expect(test.history.displayedContent.value).toBe("内容2");
    expect(
      test.history.diff.value.hunks[0]?.lines.some(
        ({ text, type }) => type === "addition" && text === "内容2"
      )
    ).toBe(true);
    vi.mocked(test.api.read).mockClear();
    await test.history.select(version(1).id);
    expect(
      vi.mocked(test.api.read).mock.calls.map(([input]) => input.versionId)
    ).toEqual([version(1).id, version(3).id]);
    test.state.sha = version(3).sha256;
    await test.history.refresh();
    expect(test.history.currentChanged.value).toBe(false);
    await test.history.select(version(3).id);
    expect(test.history.canRestore.value).toBe(false);
    test.scope.stop();
  });

  it("waits for autosave, restores with the refreshed hash, and selects the new restore version", async () => {
    const test = setup();
    const success = vi.spyOn(uiMessage, "success");
    await test.history.refresh();
    await test.history.select(version(1).id);
    test.state.unsaved = true;
    let finish!: () => void;
    test.prepare.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = () => {
            test.state.sha = "5".repeat(64);
            test.state.unsaved = false;
            resolve(true);
          };
        })
    );
    const restore = test.history.restore();
    expect(test.api.restore).not.toHaveBeenCalled();
    test.records.unshift({
      ...version(4),
      kind: "restore",
      restoredFromSeq: 1
    });
    finish();
    await restore;
    expect(test.api.restore).toHaveBeenCalledWith({
      target: { workspace: "catalog", bookId: "book", documentId: "doc" },
      versionId: version(1).id,
      expectedCurrentSha256: "5".repeat(64)
    });
    expect(test.restored).toHaveBeenCalledOnce();
    expect(test.history.selectedId.value).toBe(version(4).id);
    expect(success).toHaveBeenCalledOnce();
    test.scope.stop();
  });

  it("keeps current selected when restore saves text but cannot save history", async () => {
    const test = setup();
    await test.history.refresh();
    await test.history.select(version(1).id);
    const result = await test.api.restore({
      target: { workspace: "catalog", bookId: "book", documentId: "doc" },
      versionId: version(1).id,
      expectedCurrentSha256: test.state.sha
    });
    vi.mocked(test.api.restore).mockResolvedValue({ ...result, version: null });
    await test.history.restore();
    expect(test.history.selectedId.value).toBeNull();
    expect(test.restored).toHaveBeenCalled();
    test.scope.stop();
  });

  it("rechecks read-only state after waiting for a save", async () => {
    const test = setup();
    await test.history.refresh();
    await test.history.select(version(1).id);
    test.prepare.mockImplementationOnce(async () => {
      test.state.readOnly = true;
      return true;
    });
    await test.history.restore();
    expect(test.api.restore).not.toHaveBeenCalled();
    test.scope.stop();
  });

  it("ignores a late read after another selection", async () => {
    const test = setup();
    await test.history.refresh();
    let finish!: (
      value: Awaited<ReturnType<DocumentVersionsApi["read"]>>
    ) => void;
    vi.mocked(test.api.read).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const earlier = test.history.select(version(3).id);
    await test.history.select(version(2).id);
    finish({ version: version(3), content: "过时内容" });
    await earlier;
    expect(test.history.displayedContent.value).toBe("内容2");
    test.scope.stop();
  });
});
