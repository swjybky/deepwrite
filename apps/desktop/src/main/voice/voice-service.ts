import { secureStorage as safeStorage } from "../secure-storage";
import {
  VoiceTranscribeInputSchema,
  type VoiceSettingsInput,
  type VoiceTranscribeInput,
  type VoiceTranscribeResult,
  type VoiceUsageRecord
} from "@deepwrite/contracts";
import { electronRemoteFetch } from "../electron-remote-fetch";
import { inspectVoiceAudio } from "./voice-audio";
import { VoicePersistence, type VoiceSecureStorage } from "./voice-persistence";
import { recognizeVoice, type VoiceFetcher } from "./voice-provider";

export interface VoiceServiceOptions {
  secureStorage?: VoiceSecureStorage;
  fetcher?: VoiceFetcher;
  now?: () => number;
  timeoutMs?: number;
}

interface PendingRecognition {
  ownerId: number;
  controller: AbortController;
  timedOut: boolean;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("语音识别已取消。"));
    if (signal.aborted) {
      onAbort();
      // The underlying request may finish even after cancellation.
      void operation.catch(() => undefined);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export class VoiceService {
  private readonly persistence: VoicePersistence;
  private readonly fetcher: VoiceFetcher;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingRecognition>();

  constructor(userDataPath: string, options: VoiceServiceOptions = {}) {
    this.persistence = new VoicePersistence(
      userDataPath,
      options.secureStorage ?? safeStorage
    );
    this.fetcher = options.fetcher ?? electronRemoteFetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  getSettings() {
    return this.persistence.getSettings();
  }

  saveSettings(input: VoiceSettingsInput) {
    return this.persistence.saveSettings(input);
  }

  getUsage() {
    return this.persistence.getUsage();
  }

  async transcribe(
    input: VoiceTranscribeInput,
    ownerId: number
  ): Promise<VoiceTranscribeResult> {
    const parsed = VoiceTranscribeInputSchema.safeParse(input);
    if (!parsed.success) throw new Error("语音识别请求无效，请重新录音。");
    const recording = parsed.data;
    const { durationMs } = inspectVoiceAudio(recording.audioBase64);
    if (
      this.pending.has(recording.requestId) ||
      [...this.pending.values()].some((request) => request.ownerId === ownerId)
    ) {
      throw new Error("已有语音识别正在进行，请等待完成或取消后重试。");
    }
    const pending: PendingRecognition = {
      ownerId,
      controller: new AbortController(),
      timedOut: false
    };
    this.pending.set(recording.requestId, pending);
    const timer = setTimeout(() => {
      pending.timedOut = true;
      pending.controller.abort();
    }, this.timeoutMs);
    try {
      const [config, previous] = await Promise.all([
        this.persistence.resolve(recording.profileId),
        this.persistence.getUsage()
      ]);
      if (pending.controller.signal.aborted)
        throw new Error("语音识别已取消。");
      if (previous.some((entry) => entry.requestId === recording.requestId)) {
        throw new Error("这次录音已识别，请重新录音后再试。");
      }
      const recognition = await abortable(
        recognizeVoice(
          config,
          recording.audioBase64,
          this.fetcher,
          pending.controller.signal
        ),
        pending.controller.signal
      );
      const usage: VoiceUsageRecord = {
        requestId: recording.requestId,
        profileId: recording.profileId,
        model: config.model,
        createdAt: new Date(this.now()).toISOString(),
        durationMs: recognition.durationMs ?? durationMs,
        ...recognition.usage
      };
      // Voice has its own ledger and never emits agent/model usage events.
      await this.persistence.appendUsage(usage);
      if (pending.controller.signal.aborted)
        throw new Error("语音识别已取消。");
      if (!recognition.text)
        throw new Error("没有识别到语音内容，请重新录音。");
      return {
        text: recognition.text,
        requestId: recording.requestId,
        profileId: recording.profileId,
        usage
      };
    } catch (error) {
      if (pending.controller.signal.aborted) {
        throw new Error(
          pending.timedOut ? "语音识别超时，请稍后重试。" : "语音识别已取消。"
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.pending.delete(recording.requestId);
    }
  }

  cancel(requestId: string, ownerId: number): boolean {
    const request = this.pending.get(requestId);
    if (!request || request.ownerId !== ownerId) return false;
    request.controller.abort();
    return true;
  }

  cancelOwner(ownerId: number): void {
    for (const request of this.pending.values()) {
      if (request.ownerId === ownerId) request.controller.abort();
    }
  }
}
