import { describe, expect, it, vi } from "vitest";
import {
  BookIdentityRecordSchema,
  BookSchema,
  createCatalogDraftDirectory,
  createDefaultCreativePlotStages,
  imageModelCapability,
  type ChatAssistantProjectRef,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { CoverRenderService } from "./cover-render-service";
import { deferred } from "../../main/voice/voice-test-support";
import { IMAGE_PNG } from "../../main/image/image-test-support";
import type { ImageService } from "../../main/image/image-service";

const book = { projectType: "short" as const, projectId: "book_test" };
const input = {
  book,
  requestId: "request_test",
  roundId: "round_test",
  candidateId: "candidate_test"
};

function fixture(project: ChatAssistantProjectRef = book) {
  const record = BookIdentityRecordSchema.parse({
    schemaVersion: 1,
    kind: "deepwrite.book-identity",
    bookId: project.projectId,
    revision: 1,
    updatedAt: "2026-10-02T12:00:00.000Z",
    adopted: {},
    rounds: [
      {
        id: input.roundId,
        field: "cover",
        source: "agent",
        createdAt: "2026-10-02T12:00:00.000Z",
        request: {
          candidateCount: 1,
          imagesPerCandidate: 1,
          aspectRatio: "3:4",
          titleRendering: "overlay"
        },
        candidates: [
          {
            id: input.candidateId,
            concept: "孤灯",
            scene: "雨夜",
            composition: "顶部留白",
            palette: ["#112233"],
            artStyle: "油画",
            typography: "宋体",
            titlePlacement: "top",
            prompt: "无字夜景",
            rationale: "悬念"
          }
        ]
      }
    ]
  });
  const round = record.rounds[0]!;
  if (round.field !== "cover") throw new Error("invalid fixture");
  return { record, round, candidate: round.candidates[0]! };
}

function titleSnapshot(
  project: ChatAssistantProjectRef,
  title = "当前雨夜书名"
) {
  const now = "2026-10-02T12:00:00.000Z";
  const shared = {
    id: project.projectId,
    title,
    bookType: project.projectType,
    genre: "悬疑",
    status: "editing",
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] },
    createdAt: now,
    updatedAt: now
  };
  if (project.projectType === "long")
    return {
      updatedAt: now,
      books: [
        {
          ...shared,
          schemaVersion: 1,
          kind: "deepwrite.long-book",
          navigation: {
            schemaVersion: 1,
            bookId: project.projectId,
            updatedAt: now,
            counts: {
              worldbuildingCategories: 0,
              characters: 0,
              volumes: 0,
              arcs: 0,
              chapterCards: 0,
              committedChapters: 0,
              storyEvents: 0,
              storyPlots: 0,
              foreshadowingThreads: 0
            },
            worldbuilding: [],
            characters: [],
            volumes: [],
            arcs: [],
            chapterCards: [],
            committedThroughChapterId: null
          }
        }
      ]
    };
  const raw = BookSchema.parse({
    ...shared,
    documents: [],
    draft: createCatalogDraftDirectory(now)
  });
  const metadata = { contentBytes: 0, contentStamp: `manifest-v1:0:${now}` };
  return {
    schemaVersion: 1,
    revision: 1,
    creativePlotStages: createDefaultCreativePlotStages(),
    books: [
      {
        ...raw,
        documents: raw.documents.map((document) => ({
          ...document,
          ...metadata
        })),
        draft: {
          ...raw.draft,
          sections: raw.draft.sections.map((section) => ({
            ...section,
            body: { ...section.body, ...metadata },
            characterState: { ...section.characterState, ...metadata }
          }))
        }
      }
    ],
    materials: [],
    materialGroups: [],
    skills: [],
    skillGroups: [],
    updatedAt: now
  };
}

function imageService() {
  return {
    capability: vi
      .fn<ImageService["capability"]>()
      .mockResolvedValue(undefined),
    render: vi.fn<ImageService["render"]>().mockResolvedValue({
      images: [
        {
          png: IMAGE_PNG,
          thumbnail: Buffer.from([255, 216, 255, 217]),
          previewDataUrl: "data:image/jpeg;base64,/9j/2Q==",
          width: 600,
          height: 800
        }
      ],
      imageProfile: {
        id: "img_test",
        presetId: "openai-compatible",
        model: "invalid-test-image-model"
      }
    }),
    cancel: vi.fn()
  };
}

function renderCore(current: ReturnType<typeof fixture>, snapshot: unknown) {
  return vi.fn(async (command: CommandEnvelope): Promise<CommandResult> => ({
    status: "accepted",
    requestId: command.id,
    payload:
      command.type === "bookIdentity.readCandidate"
        ? current
        : command.type === "catalog.index" || command.type === "long.list"
          ? snapshot
          : current.record
  }));
}

describe("CoverRenderService", () => {
  it("cancels during the authoritative Core preflight before any paid request", async () => {
    const response = deferred<CommandResult>();
    const core = vi.fn(
      async (command: CommandEnvelope): Promise<CommandResult> =>
        command.type === "bookIdentity.readCandidate"
          ? response.promise
          : {
              status: "accepted",
              requestId: command.id,
              payload: fixture().record
            }
    );
    const images = imageService();
    const service = new CoverRenderService(core, images);
    const operation = service.render(input, 7);
    const rejected = expect(operation).rejects.toThrow("已取消");
    expect(service.cancel(input.requestId, 9)).toBe(false);
    expect(service.cancel(input.requestId, 7)).toBe(true);
    response.resolve({
      status: "accepted",
      requestId: "core_reply",
      payload: fixture()
    });
    await rejected;
    expect(images.render).not.toHaveBeenCalled();
    expect(service.cancel(input.requestId, 7)).toBe(false);
  });

  it("refuses paid generation when the work already holds 240 covers", async () => {
    const current = fixture();
    current.candidate.images = Array.from({ length: 240 }, (_, index) => ({
      id: `image_${index}`,
      file: `covers/image_${index}.png`,
      thumb: `covers/image_${index}.thumb.jpg`,
      width: 600,
      height: 800,
      imageProfile: {
        id: "img_test",
        presetId: "volcengine-seedream",
        model: "invalid-test-model"
      },
      createdAt: "2026-10-02T12:00:00.000Z"
    }));
    const core = vi.fn(
      async (command: CommandEnvelope): Promise<CommandResult> => ({
        status: "accepted",
        requestId: command.id,
        payload:
          command.type === "bookIdentity.readCandidate"
            ? current
            : current.record
      })
    );
    const images = imageService();
    await expect(
      new CoverRenderService(core, images).render(input, 7)
    ).rejects.toThrow("240 张");
    expect(images.render).not.toHaveBeenCalled();
  });

  it.each(["short", "script", "long"] as const)(
    "renders the current Core title for a %s work after a candidate was edited or generated earlier",
    async (projectType) => {
      const project = {
        projectType,
        projectId: projectType === "long" ? "longbook_test" : book.projectId
      };
      const current = fixture(project);
      current.round.request.titleRendering = "model";
      current.candidate.prompt = '雨夜，旧书名 "以前的书名"，no text，无字';
      current.candidate.negativePrompt =
        "文字, no text, low quality, watermark";
      current.candidate.typography = "金色手写宋体";
      current.candidate.titlePlacement = "bottom";
      const core = renderCore(current, titleSnapshot(project));
      const images = imageService();
      const service = new CoverRenderService(core, images);
      await service.render({ ...input, book: project }, 7);

      const request = images.render.mock.calls[0]![0];
      expect(request.prompt).toContain(
        'exact current book title is "当前雨夜书名"'
      );
      expect(request.prompt).toContain("complete, finished book cover");
      expect(request.prompt).toContain("金色手写宋体");
      expect(request.prompt).toContain("lower third of the cover");
      expect(request.prompt).not.toMatch(/no text|无字/u);
      expect(request.negativePrompt).toBe("low quality, watermark");
      expect(core.mock.calls.map(([command]) => command.type)).toEqual([
        "bookIdentity.readCandidate",
        projectType === "long" ? "long.list" : "catalog.index",
        "bookIdentity.writeCoverAsset"
      ]);
      expect(core.mock.calls[1]![0].context.resourceId).toBe(project.projectId);
    }
  );

  it("adds the text-free background and placement requirements even for manually edited overlay prompts", async () => {
    const current = fixture();
    current.candidate.prompt = "修改后的山水背景";
    current.candidate.titlePlacement = "center";
    const core = renderCore(current, undefined);
    const images = imageService();
    await new CoverRenderService(core, images).render(input, 7);
    const prompt = images.render.mock.calls[0]![0].prompt;
    expect(prompt).toContain("修改后的山水背景");
    expect(prompt).toContain("only a text-free book cover background");
    expect(prompt).toContain("Do not render any text");
    expect(prompt).toContain("center of the cover");
    expect(core.mock.calls.map(([command]) => command.type)).not.toContain(
      "catalog.index"
    );
  });

  it("rejects a missing or mismatched current work before a paid image request", async () => {
    const current = fixture();
    current.round.request.titleRendering = "model";
    const snapshot = titleSnapshot({ ...book, projectType: "script" });
    const core = renderCore(current, snapshot);
    const images = imageService();
    await expect(
      new CoverRenderService(core, images).render(input, 7)
    ).rejects.toThrow("作品不存在");
    expect(images.render).not.toHaveBeenCalled();
    expect(core.mock.calls.at(-1)![0].type).toBe(
      "bookIdentity.recordRenderError"
    );
  });

  it("fails without charging when the authoritative title read is rejected", async () => {
    const current = fixture();
    current.round.request.titleRendering = "model";
    const core = renderCore(current, undefined);
    core.mockImplementation(async (command) =>
      command.type === "catalog.index"
        ? {
            status: "rejected",
            requestId: command.id,
            error: { code: "test.core_read", message: "作品读取失败" }
          }
        : {
            status: "accepted",
            requestId: command.id,
            payload:
              command.type === "bookIdentity.readCandidate"
                ? current
                : current.record
          }
    );
    const images = imageService();
    await expect(
      new CoverRenderService(core, images).render(input, 7)
    ).rejects.toThrow("作品读取失败");
    expect(images.render).not.toHaveBeenCalled();
  });

  it("rejects a combined prompt beyond the image service limit before charging", async () => {
    const current = fixture();
    current.candidate.prompt = "景".repeat(8000);
    const core = renderCore(current, undefined);
    const images = imageService();
    await expect(
      new CoverRenderService(core, images).render(input, 7)
    ).rejects.toThrow("超过 8000 字符");
    expect(images.render).not.toHaveBeenCalled();
  });

  it("uses MiniMax's final prompt limit and compact lettering instructions", async () => {
    const current = fixture();
    current.round.request.titleRendering = "model";
    current.candidate.prompt = "景".repeat(650);
    current.candidate.typography = "字".repeat(120);
    const core = renderCore(current, titleSnapshot(book, "名".repeat(120)));
    const images = imageService();
    images.capability.mockResolvedValue(imageModelCapability("minimax-image"));
    const service = new CoverRenderService(core, images);
    await service.render(input, 7);
    const prompt = images.render.mock.calls[0]![0].prompt;
    expect(prompt).toContain(JSON.stringify("名".repeat(120)));
    expect(prompt.length).toBeLessThanOrEqual(1500);

    current.candidate.prompt = "景".repeat(1500);
    images.render.mockClear();
    await expect(
      service.render({ ...input, requestId: "next" }, 7)
    ).rejects.toThrow("超过 1500 字符");
    expect(images.render).not.toHaveBeenCalled();
  });

  it("cancels during the current-title read before any paid request", async () => {
    const current = fixture();
    current.round.request.titleRendering = "model";
    const response = deferred<CommandResult>();
    const started = deferred<void>();
    const core = renderCore(current, undefined);
    core.mockImplementation(async (command) => {
      if (command.type === "catalog.index") {
        started.resolve();
        return response.promise;
      }
      return {
        status: "accepted",
        requestId: command.id,
        payload:
          command.type === "bookIdentity.readCandidate"
            ? current
            : current.record
      };
    });
    const images = imageService();
    const service = new CoverRenderService(core, images);
    const operation = service.render(input, 7);
    const rejected = expect(operation).rejects.toThrow("已取消");
    await started.promise;
    expect(service.cancel(input.requestId, 7)).toBe(true);
    response.resolve({
      status: "accepted",
      requestId: "core_reply",
      payload: titleSnapshot(book)
    });
    await rejected;
    expect(images.render).not.toHaveBeenCalled();
  });

  it("does not persist an image when cancellation wins the render race", async () => {
    const current = fixture();
    const response = deferred<Awaited<ReturnType<ImageService["render"]>>>();
    const images = imageService();
    images.render.mockReturnValue(response.promise);
    const core = renderCore(current, undefined);
    const service = new CoverRenderService(core, images);
    const operation = service.render(input, 7);
    await vi.waitFor(() => expect(images.render).toHaveBeenCalled());
    expect(service.cancel(input.requestId, 7)).toBe(true);
    response.resolve({
      images: [
        {
          png: IMAGE_PNG,
          thumbnail: Buffer.from([255, 216, 255, 217]),
          previewDataUrl: "data:image/jpeg;base64,/9j/2Q==",
          width: 600,
          height: 800
        }
      ],
      imageProfile: {
        id: "img_test",
        presetId: "openai-compatible",
        model: "invalid-test-image-model"
      }
    });
    await expect(operation).rejects.toThrow("已取消");
    expect(core.mock.calls.map(([command]) => command.type)).not.toContain(
      "bookIdentity.writeCoverAsset"
    );
  });
});
