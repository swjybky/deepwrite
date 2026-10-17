import { secureStorage as safeStorage } from "../secure-storage";
import {
  CoverAspectRatioSchema,
  IMAGE_MODEL_PRESETS,
  imageModelAspectRatios,
  imageModelCapability,
  ImageModelTestInputSchema,
  type CoverAspectRatio,
  type ImageModelSettingsInput,
  type ImageModelTestInput,
  type ImageModelTestResult,
  type ImageUsageRecord
} from "@deepwrite/contracts";
import { electronRemoteFetch } from "../electron-remote-fetch";
import type { VoiceSecureStorage } from "../voice/voice-persistence";
import {
  decodeImage,
  downloadImage,
  type ImageDecoder,
  type DecodedImage
} from "./image-download";
import {
  abortImage,
  SafeImageError,
  safeImageError,
  type ImageFetcher
} from "./image-http";
import { ImagePersistence } from "./image-persistence";
import { imageAbortable, ImageQueue } from "./image-queue";
import { generateOpenAiImages } from "./providers/openai-images";
import { generateDashscopeImages } from "./providers/dashscope-async";
import { generateMiniMaxImages } from "./providers/minimax-images";

export interface ImageServiceOptions {
  secureStorage?: VoiceSecureStorage;
  fetcher?: ImageFetcher;
  decoder?: ImageDecoder;
  now?: () => number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface RenderImageInput {
  requestId: string;
  profileId?: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: CoverAspectRatio;
  images?: number;
}

interface PendingImage {
  ownerId: number;
  controller: AbortController;
}

export class ImageService {
  private readonly persistence: ImagePersistence;
  private readonly queue = new ImageQueue();
  private readonly pending = new Map<string, PendingImage>();

  constructor(
    userDataPath: string,
    private readonly options: ImageServiceOptions = {}
  ) {
    this.persistence = new ImagePersistence(
      userDataPath,
      options.secureStorage ?? safeStorage
    );
  }

  getSettings() {
    return this.persistence.getSettings();
  }
  saveSettings(input: ImageModelSettingsInput) {
    return this.persistence.saveSettings(input);
  }
  getUsage() {
    return this.persistence.getUsage();
  }

  async capability() {
    const settings = await this.getSettings();
    const active = settings.profiles.find(
      (profile) => profile.id === settings.activeProfileId
    );
    return active
      ? imageModelCapability(active.presetId, active.model)
      : undefined;
  }

  async test(
    rawInput: ImageModelTestInput,
    ownerId: number
  ): Promise<ImageModelTestResult> {
    const input = ImageModelTestInputSchema.parse(rawInput);
    const result = await this.render(input, ownerId);
    const image = result.images[0]!;
    return {
      requestId: input.requestId,
      previewDataUrl: image.previewDataUrl,
      width: image.width,
      height: image.height
    };
  }

  async render(
    input: RenderImageInput,
    ownerId: number
  ): Promise<{
    images: DecodedImage[];
    imageProfile: {
      id: string;
      presetId: keyof typeof IMAGE_MODEL_PRESETS;
      model: string;
    };
  }> {
    const count = input.images ?? 1;
    if (
      !/^[a-zA-Z0-9_-]{1,120}$/u.test(input.requestId) ||
      !input.prompt.trim() ||
      input.prompt.length > 8_000 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 4 ||
      !CoverAspectRatioSchema.safeParse(input.aspectRatio).success
    )
      throw new SafeImageError("图片生成请求无效。");
    if (this.pending.has(input.requestId))
      throw new SafeImageError("这次图片请求正在进行，请等待完成。");
    const pending = { ownerId, controller: new AbortController() };
    const signal = pending.controller.signal;
    this.pending.set(input.requestId, pending);
    const now = this.options.now ?? Date.now;
    const started = now();
    let release: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let status: ImageUsageRecord["status"] = "failed";
    let config: Awaited<ReturnType<ImagePersistence["resolve"]>> | undefined;
    let delivered = 0;
    try {
      config = await this.persistence.resolve(input.profileId);
      const previous = await this.persistence.getUsage();
      if (
        previous.some(
          (entry) =>
            entry.requestId === input.requestId && entry.status === "success"
        )
      )
        throw new SafeImageError("这次图片请求已完成，请使用新的请求重试。");
      release = await this.queue.acquire(signal);
      abortImage(signal);
      const profile = config;
      const preset = IMAGE_MODEL_PRESETS[profile.presetId];
      if (
        !imageModelAspectRatios(profile.presetId, profile.model)[
          input.aspectRatio
        ]
      )
        throw new SafeImageError("当前图片模型不支持所选比例。");
      const images: DecodedImage[] = [];
      const fetcher = this.options.fetcher ?? electronRemoteFetch;
      for (
        let offset = 0;
        offset < count;
        offset += preset.maxImagesPerRequest
      ) {
        // Every batch has the single-image timeout; cover batches contain exactly one image.
        timer = setTimeout(
          () => {
            timedOut = true;
            pending.controller.abort();
          },
          (this.options.timeoutMs ?? 180_000) *
            Math.min(preset.maxImagesPerRequest, count - offset)
        );
        const generation = {
          profile,
          prompt: input.prompt,
          ...(input.negativePrompt
            ? { negativePrompt: input.negativePrompt }
            : {}),
          aspectRatio: input.aspectRatio,
          images: Math.min(preset.maxImagesPerRequest, count - offset)
        };
        const sources = await imageAbortable(
          preset.protocol === "minimax-images"
            ? generateMiniMaxImages(generation, fetcher, signal)
            : preset.protocol === "dashscope-async"
              ? generateDashscopeImages(
                  generation,
                  fetcher,
                  signal,
                  this.options.pollIntervalMs
                )
              : generateOpenAiImages(generation, fetcher, signal),
          signal
        );
        delivered += sources.length;
        for (const source of sources) {
          const buffer = await imageAbortable(
            downloadImage(source, fetcher, signal),
            signal
          );
          abortImage(signal);
          images.push(decodeImage(buffer, this.options.decoder));
        }
        clearTimeout(timer);
      }
      status = "success";
      return {
        images,
        imageProfile: {
          id: profile.id,
          presetId: profile.presetId,
          model: profile.model
        }
      };
    } catch (error) {
      if (signal.aborted) {
        status = "cancelled";
        throw new SafeImageError(
          timedOut ? "图片生成超时，请稍后重试。" : "图片生成已取消。"
        );
      }
      throw new SafeImageError(safeImageError(error));
    } finally {
      if (timer) clearTimeout(timer);
      release?.();
      this.pending.delete(input.requestId);
      if (config)
        await this.persistence.appendUsage({
          requestId: input.requestId,
          profileId: config.id,
          model: config.model,
          images: status === "success" ? count : delivered,
          size:
            imageModelAspectRatios(config.presetId, config.model)[
              input.aspectRatio
            ] ?? input.aspectRatio,
          durationMs: Math.max(0, now() - started),
          status,
          createdAt: new Date(started).toISOString()
        });
    }
  }

  cancel(requestId: string, ownerId: number): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.ownerId !== ownerId) return false;
    pending.controller.abort();
    return true;
  }

  cancelOwner(ownerId: number): void {
    for (const pending of this.pending.values())
      if (pending.ownerId === ownerId) pending.controller.abort();
  }
}
