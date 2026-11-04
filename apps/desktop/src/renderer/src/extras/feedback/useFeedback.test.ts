import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeepWriteApi,
  FeedbackItem,
  FeedbackPage,
  MarketplaceSession
} from "@deepwrite/contracts";
import { uiMessage } from "../../ui-feedback";
import { createSSRApp, effectScope, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { useFeedback } from "./useFeedback";
import { feedbackDraft } from "./feedbackDraft";
import { pastedImages } from "./feedbackImage";
import FeedbackHistory from "./FeedbackHistory.vue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const signedIn = {
  authenticated: true,
  user: { id: "u1", username: "author", displayName: "作者" },
  persistent: true,
  insecureTransport: false
} as MarketplaceSession;
const signedOut = {
  authenticated: false,
  persistent: false,
  insecureTransport: false
} as MarketplaceSession;

const item: FeedbackItem = {
  id: "f1",
  tag: "bug",
  content: "保存后闪退",
  status: "done",
  reply: "已修复",
  repliedAt: "2026-11-01T08:00:00Z",
  images: [{ id: "i1", contentType: "image/webp", byteSize: 4 }],
  createdAt: "2026-11-01T07:00:00Z",
  updatedAt: "2026-11-01T08:00:00Z"
};
const page: FeedbackPage = {
  items: [item],
  page: 1,
  pageSize: 10,
  total: 1,
  totalPages: 1
};

function setup(session: MarketplaceSession = signedIn) {
  const marketplace = { session: vi.fn(async () => session) };
  const feedback = {
    list: vi.fn(async () => page),
    submit: vi.fn(async () => item),
    image: vi.fn(async () => ({
      contentType: "image/webp" as const,
      data: "QUJD"
    })),
    captureWindow: vi.fn(async () => ({
      contentType: "image/png" as const,
      data: "QUJD"
    }))
  };
  const api = { marketplace, feedback } as unknown as DeepWriteApi;
  const onSessionChange = vi.fn();
  const onUnavailable = vi.fn();
  const compress = vi.fn(async () => ({
    id: crypto.randomUUID(),
    data: "QUJD",
    previewUrl: "data:image/webp;base64,QUJD"
  }));
  const steps: string[] = [];
  const state = useFeedback({
    api: () => api,
    onSessionChange,
    onUnavailable,
    compress,
    waitForHiddenDialog: async () => {
      steps.push(`hidden:${String(state.capturing.value)}`);
    }
  });
  return {
    state,
    marketplace,
    feedback,
    compress,
    onSessionChange,
    onUnavailable,
    steps
  };
}

describe("useFeedback", () => {
  beforeEach(() => {
    feedbackDraft.reset();
    vi.restoreAllMocks();
    vi.spyOn(uiMessage, "error").mockReturnValue(0);
    vi.spyOn(uiMessage, "warning").mockReturnValue(0);
    vi.spyOn(uiMessage, "success").mockReturnValue(0);
  });

  it("asks a signed-out user to sign in and shares the new session", async () => {
    const { state, onSessionChange } = setup(signedOut);
    await state.restoreSession();
    expect(state.authenticated.value).toBe(false);
    state.applySession(signedIn);
    expect(state.authenticated.value).toBe(true);
    expect(onSessionChange).toHaveBeenLastCalledWith(signedIn);
  });

  it("closes when the session cannot be read", async () => {
    const { state, marketplace, onUnavailable } = setup();
    marketplace.session.mockRejectedValueOnce(new Error("offline"));
    await state.restoreSession();
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(uiMessage.error).toHaveBeenCalledOnce();
  });

  it("submits the draft, clears it and shows the user's list", async () => {
    const { state, feedback } = setup();
    await state.restoreSession();
    feedbackDraft.tag.value = "feature";
    feedbackDraft.content.value = "想要深色封面";
    await state.addImages([new Blob(["a"])]);
    await state.submit();
    await vi.waitFor(() => expect(state.history.value).toEqual(page));
    expect(feedback.submit).toHaveBeenCalledWith({
      tag: "feature",
      content: "想要深色封面",
      images: ["QUJD"]
    });
    expect(feedbackDraft.content.value).toBe("");
    expect(feedbackDraft.images.value).toEqual([]);
    expect(state.tab.value).toBe("history");
  });

  it("leaves the tag out when none is chosen and refuses blank feedback", async () => {
    const { state, feedback } = setup();
    feedbackDraft.content.value = "   ";
    await state.submit();
    expect(feedback.submit).not.toHaveBeenCalled();
    feedbackDraft.content.value = "内容";
    await state.submit();
    expect(feedback.submit).toHaveBeenCalledWith({
      content: "内容",
      images: []
    });
  });

  it("keeps the draft when submitting fails", async () => {
    const { state, feedback } = setup();
    feedback.submit.mockRejectedValueOnce(new Error("服务不可用"));
    feedbackDraft.content.value = "内容";
    await state.submit();
    expect(feedbackDraft.content.value).toBe("内容");
    expect(state.submitting.value).toBe(false);
    expect(state.tab.value).toBe("compose");
    expect(uiMessage.error).toHaveBeenCalledWith("服务不可用");
  });

  it.each(["content", "tag", "images"] as const)(
    "keeps unsent %s edits when an earlier submission succeeds",
    async (field) => {
      const { state, feedback } = setup();
      feedbackDraft.content.value = "已提交内容";
      const response = deferred<FeedbackItem>();
      feedback.submit.mockReturnValueOnce(response.promise);
      const pending = state.submit();
      if (field === "content") feedbackDraft.content.value = "后来补写的内容";
      if (field === "tag") feedbackDraft.tag.value = "feature";
      if (field === "images") await state.addImages([new Blob(["new image"])]);
      const edited = feedbackDraft.snapshot();
      response.resolve(item);
      await pending;
      expect(feedback.submit).toHaveBeenCalledWith({
        content: "已提交内容",
        images: []
      });
      expect(feedbackDraft.snapshot()).toEqual(edited);
      expect(state.tab.value).toBe("compose");
      expect(state.canSubmit.value).toBe(true);
    }
  );

  it("keeps the draft while a newly added image is still being compressed", async () => {
    const { state, feedback, compress } = setup();
    feedbackDraft.content.value = "内容";
    const response = deferred<FeedbackItem>();
    const image = {
      id: crypto.randomUUID(),
      data: "QUJD",
      previewUrl: "data:image/webp;base64,QUJD"
    };
    const compression = deferred<typeof image>();
    feedback.submit.mockReturnValueOnce(response.promise);
    compress.mockReturnValueOnce(compression.promise);
    const pending = state.submit();
    const adding = state.addImages([new Blob(["new image"])]);
    response.resolve(item);
    await pending;
    expect(feedbackDraft.content.value).toBe("内容");
    expect(state.canSubmit.value).toBe(false);
    compression.resolve(image);
    await adding;
    expect(feedbackDraft.images.value).toEqual([image]);
    expect(state.canSubmit.value).toBe(true);
  });

  it.each(["success", "failure"] as const)(
    "blocks duplicate submission across dialog recreation and releases the lock on %s",
    async (outcome) => {
      const scope = effectScope();
      const original = scope.run(() => setup())!;
      feedbackDraft.content.value = "内容";
      const response = deferred<FeedbackItem>();
      original.feedback.submit.mockReturnValueOnce(response.promise);
      const pending = original.state.submit();
      scope.stop();
      const reopened = setup();
      expect(reopened.state.submitting.value).toBe(true);
      expect(reopened.state.canSubmit.value).toBe(false);
      await reopened.state.submit();
      expect(reopened.feedback.submit).not.toHaveBeenCalled();
      if (outcome === "success") response.resolve(item);
      else response.reject(new Error("offline"));
      await pending;
      expect(reopened.state.submitting.value).toBe(false);
      expect(original.feedback.list).not.toHaveBeenCalled();
      expect(feedbackDraft.content.value).toBe(
        outcome === "success" ? "" : "内容"
      );
      feedbackDraft.content.value = "下一条";
      await reopened.state.submit();
      expect(reopened.feedback.submit).toHaveBeenCalledOnce();
    }
  );

  it("retries the failed history page and shows an empty list only after success", async () => {
    const { state, feedback } = setup();
    feedback.list.mockRejectedValueOnce(new Error("offline"));
    await state.loadHistory(2);
    expect(state.historyLoading.value).toBe(false);
    expect(state.history.value).toBeNull();
    const render = () =>
      renderToString(
        createSSRApp({
          render: () =>
            h(FeedbackHistory, {
              history: state.history.value,
              loading: state.historyLoading.value,
              imageSources: {},
              openImageSets: new Set<string>()
            })
        })
      );
    const failed = await render();
    expect(failed).toContain("刷新反馈");
    expect(failed).not.toContain("正在读取");
    expect(failed).not.toContain("还没有提交过反馈");
    const response = deferred<FeedbackPage>();
    feedback.list.mockReturnValueOnce(response.promise);
    const retry = state.retryHistory();
    expect(await render()).toContain("正在读取");
    expect(feedback.list).toHaveBeenLastCalledWith({ page: 2 });
    response.resolve({ ...page, items: [], total: 0, totalPages: 0 });
    await retry;
    expect(await render()).toContain("还没有提交过反馈");
  });

  it("returns to the login form when the token was rejected", async () => {
    const { state, feedback, marketplace } = setup();
    await state.restoreSession();
    feedback.list.mockRejectedValueOnce(new Error("登录已失效"));
    marketplace.session.mockResolvedValueOnce(signedOut);
    await state.loadHistory();
    expect(state.authenticated.value).toBe(false);
  });

  it("stops at three screenshots", async () => {
    const { state, compress } = setup();
    await state.addImages([
      new Blob(["1"]),
      new Blob(["2"]),
      new Blob(["3"]),
      new Blob(["4"])
    ]);
    expect(compress).toHaveBeenCalledTimes(3);
    expect(feedbackDraft.images.value).toHaveLength(3);
    expect(uiMessage.warning).toHaveBeenCalledOnce();
    expect(state.imagesFull.value).toBe(true);
    await state.captureWindow();
    expect(compress).toHaveBeenCalledTimes(3);
  });

  it("skips an unreadable image and keeps the others", async () => {
    const { state, compress } = setup();
    compress.mockRejectedValueOnce(new Error("bad image"));
    await state.addImages([new Blob(["1"]), new Blob(["2"])]);
    expect(feedbackDraft.images.value).toHaveLength(1);
    expect(uiMessage.error).toHaveBeenCalledOnce();
  });

  it("hides the dialog before capturing and adds the shot to the draft", async () => {
    const { state, feedback, steps } = setup();
    await state.captureWindow();
    expect(steps).toEqual(["hidden:true"]);
    expect(feedback.captureWindow).toHaveBeenCalledOnce();
    expect(state.capturing.value).toBe(false);
    expect(feedbackDraft.images.value).toHaveLength(1);
  });

  it("shows the dialog again when capturing fails", async () => {
    const { state, feedback } = setup();
    feedback.captureWindow.mockRejectedValueOnce(new Error("failed"));
    await state.captureWindow();
    expect(state.capturing.value).toBe(false);
    expect(feedbackDraft.images.value).toEqual([]);
  });

  it("loads screenshots once, on demand", async () => {
    const { state, feedback } = setup();
    await state.toggleImages(item);
    expect(state.openImageSets.value.has("f1")).toBe(true);
    expect(state.imageSources.value.i1).toBe("data:image/webp;base64,QUJD");
    await state.toggleImages(item);
    expect(state.openImageSets.value.has("f1")).toBe(false);
    await state.toggleImages(item);
    expect(feedback.image).toHaveBeenCalledOnce();
  });

  it("ignores a slower reply from an earlier page", async () => {
    const { state, feedback } = setup();
    let resolveFirst!: (value: FeedbackPage) => void;
    feedback.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    const first = state.loadHistory(1);
    feedback.list.mockResolvedValueOnce({ ...page, page: 2 });
    await state.loadHistory(2);
    resolveFirst(page);
    await first;
    expect(state.history.value?.page).toBe(2);
  });
});

describe("pastedImages", () => {
  const transfer = (text: string, files: File[]) =>
    ({ getData: () => text, files }) as unknown as DataTransfer;
  const image = new File(["a"], "shot.png", { type: "image/png" });

  it("takes a pasted screenshot but leaves copied text to the textarea", () => {
    expect(pastedImages(transfer("", [image]))).toEqual([image]);
    expect(pastedImages(transfer("一段文字", [image]))).toEqual([]);
    expect(pastedImages(null)).toEqual([]);
    expect(
      pastedImages(
        transfer("", [new File(["a"], "a.pdf", { type: "application/pdf" })])
      )
    ).toEqual([]);
  });
});
