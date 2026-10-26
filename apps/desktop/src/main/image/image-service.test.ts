import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageService } from "./image-service";
import {
  IMAGE_PNG,
  imageResponse,
  imageSettingsInput,
  INVALID_IMAGE_KEY,
  testImageDecoder,
  testSecureStorage
} from "./image-test-support";
import { deferred } from "../voice/voice-test-support";
import type { ImageFetcher } from "./image-http";
import { openAiImageBody } from "./providers/openai-images";

vi.mock("electron", () => ({
  safeStorage: {},
  nativeImage: {},
  net: { fetch: vi.fn() }
}));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
});

async function setup(fetcher: ImageFetcher, timeoutMs = 5_000) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-image-service-"));
  roots.push(root);
  const service = new ImageService(root, {
    fetcher,
    secureStorage: testSecureStorage,
    decoder: testImageDecoder,
    timeoutMs,
    pollIntervalMs: 1
  });
  await service.saveSettings(imageSettingsInput());
  return service;
}

const input = (requestId = "request_test") => ({
  requestId,
  prompt: "无字书籍底图",
  aspectRatio: "3:4" as const
});

describe("ImageService", () => {
  it("keeps credentials in Main, uses the provider variant and records privacy-safe usage", async () => {
    const fetcher = vi
      .fn<ImageFetcher>()
      .mockImplementation(async () => imageResponse());
    const service = await setup(fetcher);
    expect((await service.render(input(), 1)).images[0]!.png).toEqual(
      IMAGE_PNG
    );
    expect(fetcher.mock.calls[0]![0]).toBe(
      "https://image.example.test/v1/images/generations"
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      redirect: "error",
      headers: { Authorization: `Bearer ${INVALID_IMAGE_KEY}` }
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({
      sequential_image_generation: "disabled",
      response_format: "b64_json"
    });
    const usage = await service.getUsage();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      images: 1,
      status: "success",
      profileId: "img_test"
    });
    expect(JSON.stringify(usage)).not.toContain(input().prompt);
    expect(JSON.stringify(usage)).not.toContain(INVALID_IMAGE_KEY);
    await expect(service.render(input(), 1)).rejects.toThrow("已完成");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("splits image counts beyond the preset limit", async () => {
    const fetcher = vi
      .fn<ImageFetcher>()
      .mockImplementation(async () => imageResponse());
    const service = await setup(fetcher);
    expect(
      (await service.render({ ...input(), images: 3 }, 1)).images
    ).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("limits the entire service to two remote requests and cancels queued requests without charging", async () => {
    const response = deferred<Response>();
    let requests = 0;
    const started = deferred<void>();
    const service = await setup(async () => {
      if (++requests === 2) started.resolve();
      return (await response.promise).clone();
    });
    const first = service.render(input("first"), 1);
    const second = service.render(input("second"), 2);
    await started.promise;
    const third = service.render(input("third"), 3);
    const thirdRejected = expect(third).rejects.toThrow("已取消");
    expect(requests).toBe(2);
    expect(service.cancel("third", 4)).toBe(false);
    expect(service.cancel("third", 3)).toBe(true);
    await thirdRejected;
    // Each transport needs an independent Response body.
    response.resolve(imageResponse());
    await Promise.all([first, second]);
    expect(requests).toBe(2);
    expect(
      (await service.getUsage()).find((usage) => usage.requestId === "third")
    ).toMatchObject({ status: "cancelled", images: 0 });
  });

  it("interrupts transport even when it ignores AbortSignal and reports timeout", async () => {
    const started = deferred<void>();
    const service = await setup(async () => {
      started.resolve();
      return new Promise(() => undefined);
    }, 30);
    const operation = service.render(input(), 9);
    const rejection = expect(operation).rejects.toThrow("超时");
    await started.promise;
    await rejection;
    expect((await service.getUsage())[0]).toMatchObject({
      status: "cancelled",
      images: 0
    });
  });

  it("retries a 429 once and redacts network/provider errors", async () => {
    const fetcher = vi
      .fn<ImageFetcher>()
      .mockResolvedValueOnce(new Response(INVALID_IMAGE_KEY, { status: 429 }))
      .mockImplementationOnce(async () => imageResponse())
      .mockRejectedValueOnce(
        new Error(`https://signed.example.test/a?key=${INVALID_IMAGE_KEY}`)
      );
    const service = await setup(fetcher);
    await service.render(input(), 1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(service.render(input("next"), 1)).rejects.not.toThrow(
      INVALID_IMAGE_KEY
    );
    await expect(service.render(input("third"), 1)).rejects.not.toThrow(
      "signed.example.test"
    );
  });

  it("polls DashScope until completion using only the returned task ID", async () => {
    const fetcher = vi
      .fn<ImageFetcher>()
      .mockResolvedValueOnce(
        Response.json({
          output: { task_id: "task_123", task_status: "PENDING" }
        })
      )
      .mockResolvedValueOnce(
        Response.json({ output: { task_status: "RUNNING" } })
      )
      .mockResolvedValueOnce(
        Response.json({
          output: {
            task_status: "SUCCEEDED",
            results: [
              {
                url: "https://image.example.test/result.png?signature=invalid-placeholder"
              }
            ]
          }
        })
      )
      .mockImplementationOnce(async () => new Response(IMAGE_PNG));
    const service = await setup(fetcher);
    const settings = imageSettingsInput();
    settings.profiles[0]!.presetId = "aliyun-qwen-image";
    await service.saveSettings(settings);
    await service.render(input(), 1);
    expect(fetcher.mock.calls[0]![0]).toContain(
      "/api/v1/services/aigc/text2image/image-synthesis"
    );
    expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({
      "X-DashScope-Async": "enable"
    });
    expect(fetcher.mock.calls[1]![0]).toContain("/api/v1/tasks/task_123");
    expect(fetcher.mock.calls[3]![1]!.headers).toBeUndefined();
  });

  it("adapts SiliconFlow and OpenAI parameters without unsupported fields", () => {
    const base = {
      profile: {
        ...imageSettingsInput().profiles[0]!,
        id: "img_test",
        hasApiKey: true,
        apiKey: INVALID_IMAGE_KEY
      },
      prompt: "底图",
      aspectRatio: "1:1" as const,
      images: 1
    };
    expect(
      openAiImageBody({
        ...base,
        profile: { ...base.profile, presetId: "siliconflow" }
      })
    ).toMatchObject({ image_size: "1024x1024", batch_size: 1 });
    const body = openAiImageBody({
      ...base,
      profile: {
        ...base.profile,
        presetId: "openai-compatible",
        model: "gpt-image-1",
        quality: "standard"
      }
    });
    expect(body).toMatchObject({ size: "1024x1024", n: 1, quality: "medium" });
    expect(body).not.toHaveProperty("response_format");
  });

  it.each([
    ["3:4", "768x1024"],
    ["9:16", "864x1536"]
  ] as const)(
    "renders compatible Qwen images at %s and records the requested size",
    async (aspectRatio, size) => {
      const fetcher = vi
        .fn<ImageFetcher>()
        .mockImplementation(async () => imageResponse());
      const service = await setup(fetcher);
      const settings = imageSettingsInput();
      settings.profiles[0]!.presetId = "openai-compatible";
      settings.profiles[0]!.model = "qwen-image-2.0";
      await service.saveSettings(settings);

      expect((await service.capability())?.aspectRatios).toEqual(
        expect.arrayContaining(["3:4", "9:16"])
      );
      await service.render({ ...input(), aspectRatio }, 1);
      expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject(
        { model: "qwen-image-2.0", size, n: 1 }
      );
      expect((await service.getUsage())[0]).toMatchObject({
        model: "qwen-image-2.0",
        size,
        images: 1,
        status: "success"
      });
    }
  );

  it.each(["3:4", "9:16"] as const)(
    "rejects GPT Image %s before invoking the transport",
    async (aspectRatio) => {
      const fetcher = vi.fn<ImageFetcher>();
      const service = await setup(fetcher);
      const settings = imageSettingsInput();
      settings.profiles[0]!.presetId = "openai-compatible";
      settings.profiles[0]!.model = "gpt-image-1";
      settings.profiles[0]!.defaultAspectRatio = "2:3";
      await service.saveSettings(settings);

      expect((await service.capability())?.aspectRatios).not.toContain(
        aspectRatio
      );
      expect(() =>
        openAiImageBody({
          profile: {
            ...settings.profiles[0]!,
            id: "img_test",
            hasApiKey: true,
            apiKey: INVALID_IMAGE_KEY
          },
          prompt: input().prompt,
          aspectRatio,
          images: 1
        })
      ).toThrow("不支持所选比例");
      await expect(
        service.render({ ...input(), aspectRatio }, 1)
      ).rejects.toThrow("不支持所选比例");
      expect(fetcher).not.toHaveBeenCalled();
      expect((await service.getUsage())[0]).toMatchObject({
        model: "gpt-image-1",
        images: 0,
        status: "failed"
      });
    }
  );
});
