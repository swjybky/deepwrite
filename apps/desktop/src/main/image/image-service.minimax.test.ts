import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvelope } from "@deepwrite/contracts";
import { ImageService } from "./image-service";
import { handleImageCommands } from "./image-commands";
import type { ImageFetcher } from "./image-http";
import {
  IMAGE_PNG,
  imageSettingsInput,
  INVALID_IMAGE_KEY,
  testImageDecoder,
  testSecureStorage
} from "./image-test-support";
import { deferred } from "../voice/voice-test-support";

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

function settings() {
  const value = imageSettingsInput();
  Object.assign(value.profiles[0]!, {
    presetId: "minimax-image",
    model: "image-01",
    defaultAspectRatio: "9:16",
    watermark: false,
    quality: "high"
  });
  return value;
}

const success = (data = { image_base64: [IMAGE_PNG.toString("base64")] }) =>
  Response.json({
    data,
    base_resp: { status_code: 0, status_msg: "success" }
  });

async function setup(fetcher: ImageFetcher, timeoutMs = 5000) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-image-minimax-"));
  roots.push(root);
  const service = new ImageService(root, {
    fetcher,
    secureStorage: testSecureStorage,
    decoder: testImageDecoder,
    timeoutMs
  });
  await service.saveSettings(settings());
  return service;
}

const input = {
  requestId: "minimax_test",
  profileId: "img_test",
  prompt: "A quiet text-free book cover background",
  aspectRatio: "9:16" as const
};

describe("MiniMax image generation", () => {
  it.each([
    ["3:4", "864x1152"],
    ["2:3", "832x1248"],
    ["9:16", "720x1280"],
    ["1:1", "1024x1024"],
    ["16:9", "1280x720"]
  ] as const)(
    "generates %s through native parameters and records the provider dimensions",
    async (aspectRatio, size) => {
      const fetcher = vi
        .fn<ImageFetcher>()
        .mockImplementation(async () => success());
      const service = await setup(fetcher);
      const result = await service.test({ ...input, aspectRatio }, 7);
      expect(result.previewDataUrl).toMatch(/^data:image\/jpeg;base64,/u);
      expect(result).toMatchObject({ width: 600, height: 800 });
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, request] = fetcher.mock.calls[0]!;
      expect(url).toBe("https://image.example.test/v1/image_generation");
      expect(request).toMatchObject({
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${INVALID_IMAGE_KEY}`
        }
      });
      expect(JSON.parse(String(request!.body))).toEqual({
        model: "image-01",
        prompt: input.prompt,
        aspect_ratio: aspectRatio,
        n: 1,
        response_format: "base64",
        aigc_watermark: false
      });
      const usage = await service.getUsage();
      expect(usage[0]).toMatchObject({
        model: "image-01",
        size,
        images: 1,
        status: "success"
      });
      expect(JSON.stringify(usage)).not.toContain(input.prompt);
      expect(JSON.stringify(usage)).not.toContain(INVALID_IMAGE_KEY);
      expect((await service.getSettings()).profiles[0]).not.toHaveProperty(
        "apiKey"
      );
    }
  );

  it("decodes Base64 output without downloading and splits cover batches into individual requests", async () => {
    const fetcher = vi
      .fn<ImageFetcher>()
      .mockImplementation(async () => success());
    const service = await setup(fetcher);
    const config = settings();
    config.profiles[0]!.watermark = true;
    config.profiles[0]!.baseUrl += "/";
    await service.saveSettings(config);
    const result = await service.render(
      { ...input, images: 3, negativePrompt: "low quality" },
      7
    );
    expect(result.images).toHaveLength(3);
    expect(result.images[0]!.png).toEqual(IMAGE_PNG);
    expect(result.imageProfile).toEqual({
      id: "img_test",
      presetId: "minimax-image",
      model: "image-01"
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, request] of fetcher.mock.calls) {
      expect(url).toBe("https://image.example.test/v1/image_generation");
      const body = JSON.parse(String(request!.body));
      expect(body).toMatchObject({ n: 1, aigc_watermark: true });
      expect(body).not.toHaveProperty("quality");
      expect(body).not.toHaveProperty("negative_prompt");
    }
    expect((await service.getUsage())[0]).toMatchObject({
      images: 3,
      status: "success"
    });
  });

  it("downloads URL results through the existing HTTPS path without forwarding the API key", async () => {
    const url =
      "https://cdn.example.test/image.png?signature=invalid-placeholder";
    const fetcher = vi
      .fn<ImageFetcher>()
      .mockResolvedValueOnce(
        Response.json({
          data: { image_base64: [], image_urls: [url] },
          base_resp: { status_code: 0, status_msg: "success" }
        })
      )
      .mockResolvedValueOnce(new Response(IMAGE_PNG));
    const service = await setup(fetcher);
    expect((await service.render(input, 7)).images[0]!.png).toEqual(IMAGE_PNG);
    expect(fetcher.mock.calls[1]![0]).toBe(url);
    expect(fetcher.mock.calls[1]![1]!.headers).toBeUndefined();
    expect(JSON.stringify(await service.getUsage())).not.toContain("signature");
  });

  it.each([
    [1004, "API Key"],
    [2049, "API Key"],
    [1008, "余额不足"],
    [1002, "过于频繁"],
    [1026, "内容检查"],
    [1027, "内容检查"],
    [2013, "参数无效"],
    [2056, "用量达到限制"],
    [9999, "错误码 9999"]
  ])(
    "rejects HTTP 200 business failure %i with a safe explanation",
    async (code, message) => {
      const fetcher = vi.fn<ImageFetcher>().mockResolvedValue(
        Response.json({
          data: { image_base64: [IMAGE_PNG.toString("base64")] },
          base_resp: {
            status_code: code,
            status_msg: `${INVALID_IMAGE_KEY} ${input.prompt} https://cdn.example.test/a?secret=invalid-placeholder`
          }
        })
      );
      const service = await setup(fetcher);
      const result = await handleImageCommands(
        createEnvelope("imageModels.test", input, { id: input.requestId }),
        service,
        7
      );
      expect(result).toMatchObject({
        status: "rejected",
        error: {
          code: "image.operation_failed",
          message: expect.stringContaining(String(message))
        }
      });
      expect(JSON.stringify(result)).not.toContain(INVALID_IMAGE_KEY);
      expect(JSON.stringify(result)).not.toContain(input.prompt);
      expect(JSON.stringify(result)).not.toContain("cdn.example.test");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect((await service.getUsage())[0]).toMatchObject({
        images: 0,
        status: "failed"
      });
    }
  );

  it.each([
    {
      label: "missing status",
      response: { data: { image_base64: ["invalid"] } }
    },
    { label: "invalid status", response: { base_resp: { status_code: "0" } } },
    { label: "missing data", response: { base_resp: { status_code: 0 } } },
    {
      label: "array data",
      response: { base_resp: { status_code: 0 }, data: [] }
    },
    {
      label: "empty output",
      response: { base_resp: { status_code: 0 }, data: { image_base64: [] } }
    },
    {
      label: "invalid output",
      response: {
        base_resp: { status_code: 0 },
        data: { image_base64: [null] }
      }
    },
    {
      label: "wrong count",
      response: {
        base_resp: { status_code: 0 },
        data: { image_base64: ["invalid", "invalid"] }
      }
    }
  ])("rejects $label without reporting success", async ({ response }) => {
    const fetcher = vi
      .fn<ImageFetcher>()
      .mockResolvedValue(Response.json(response));
    const service = await setup(fetcher);
    await expect(service.render(input, 7)).rejects.toThrow();
    expect((await service.getUsage())[0]).toMatchObject({
      images: 0,
      status: "failed"
    });
  });

  it("accepts 1500 characters and rejects oversized prompts before invoking the provider", async () => {
    const fetcher = vi
      .fn<ImageFetcher>()
      .mockImplementation(async () => success());
    const service = await setup(fetcher);
    await service.render({ ...input, prompt: "a".repeat(1500) }, 7);
    await expect(
      service.render(
        { ...input, requestId: "too_long", prompt: "a".repeat(1501) },
        7
      )
    ).rejects.toThrow("1500 字符");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await service.getUsage()).at(-1)).toMatchObject({
      images: 0,
      status: "failed"
    });
  });

  it.each(["cancel", "timeout"] as const)(
    "supports %s even when the MiniMax transport ignores AbortSignal",
    async (mode) => {
      const started = deferred<void>();
      const service = await setup(
        async () => {
          started.resolve();
          return new Promise(() => undefined);
        },
        mode === "timeout" ? 30 : 5000
      );
      const operation = service.render(input, 7);
      const rejected = expect(operation).rejects.toThrow(
        mode === "timeout" ? "超时" : "已取消"
      );
      await started.promise;
      if (mode === "cancel") {
        expect(service.cancel(input.requestId, 8)).toBe(false);
        expect(service.cancel(input.requestId, 7)).toBe(true);
      }
      await rejected;
      expect((await service.getUsage())[0]).toMatchObject({
        images: 0,
        status: "cancelled"
      });
    }
  );
});
