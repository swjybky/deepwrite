import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  VoiceProfileId,
  VoiceTranscribeInput
} from "@deepwrite/contracts";
import { VoiceService } from "./voice-service";
import type { VoiceFetcher } from "./voice-provider";
import {
  INVALID_VOICE_KEY,
  deferred,
  testSecureStorage,
  voiceSettingsInput,
  voiceWav
} from "./voice-test-support";

vi.mock("electron", () => ({ safeStorage: {}, net: { fetch: vi.fn() } }));

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

function input(
  profileId: VoiceProfileId = "mimo-token-plan",
  requestId = "voice-request-1"
): VoiceTranscribeInput {
  return {
    profileId,
    requestId,
    audioBase64: voiceWav().toString("base64"),
    durationMs: 9_999
  };
}

function mimoResponse(text = "今天开始写作。") {
  return Response.json({
    choices: [{ message: { content: text } }],
    usage: {
      prompt_tokens: 8,
      completion_tokens: 6,
      total_tokens: 14,
      seconds: 1
    }
  });
}

async function setup(fetcher: VoiceFetcher, timeoutMs = 2_000) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-voice-"));
  roots.push(root);
  const service = new VoiceService(root, {
    fetcher,
    timeoutMs,
    secureStorage: testSecureStorage,
    now: () => Date.parse("2026-09-28T00:00:00.000Z")
  });
  await service.saveSettings(voiceSettingsInput());
  return { service, root };
}

describe("VoiceService", () => {
  it.each(["mimo-token-plan", "mimo-api"] as const)(
    "sends %s audio directly and keeps usage separate",
    async (profileId) => {
      const fetcher = vi
        .fn<VoiceFetcher>()
        .mockImplementation(async () => mimoResponse());
      const { service, root } = await setup(fetcher);
      const result = await service.transcribe(input(profileId), 11);
      const [url, options] = fetcher.mock.calls[0]!;
      expect(url).toBe("https://voice.example.test/v1/chat/completions");
      expect(options).toMatchObject({
        method: "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${INVALID_VOICE_KEY}` }
      });
      expect(JSON.parse(String(options?.body))).toEqual({
        model: "mimo-v2.5-asr",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: `data:audio/wav;base64,${input().audioBase64}`
                }
              }
            ]
          }
        ],
        stream: false,
        asr_options: { language: "auto" }
      });
      expect(result.text).toBe("今天开始写作。");
      expect(result.usage).toEqual({
        requestId: "voice-request-1",
        profileId,
        model: "mimo-v2.5-asr",
        createdAt: "2026-09-28T00:00:00.000Z",
        durationMs: 1_000,
        inputTokens: 8,
        outputTokens: 6,
        totalTokens: 14
      });
      await expect(service.getUsage()).resolves.toEqual([result.usage]);
      expect(
        (await readdir(join(root, "config")))
          .filter((name) => name !== ".locks")
          .sort()
      ).toEqual(["voice-usage.json", "voice.json"]);
    }
  );

  it.each(["aliyun-token-plan", "aliyun-api"] as const)(
    "sends %s via the DashScope Audio 3.x protocol",
    async (profileId) => {
      const fetcher = vi.fn<VoiceFetcher>().mockImplementation(async () =>
        Response.json({
          output: { text: "你好，世界。" },
          usage: { duration: 1 }
        })
      );
      const { service } = await setup(fetcher);
      const settings = voiceSettingsInput();
      settings.language = "zh";
      settings.profiles.find((profile) => profile.id === profileId)!.baseUrl =
        "https://voice.example.test/api/v1";
      await service.saveSettings(settings);
      const result = await service.transcribe(input(profileId), 11);
      const [url, options] = fetcher.mock.calls[0]!;
      expect(url).toBe(
        "https://voice.example.test/api/v1/services/aigc/multimodal-generation/generation"
      );
      expect(options?.headers).toMatchObject({ "X-DashScope-SSE": "disable" });
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe("qwen-audio-3.0-asr-flash");
      expect(body.input.messages[0].content[0]).toEqual({
        type: "input_audio",
        input_audio: { data: `data:audio/wav;base64,${input().audioBase64}` }
      });
      expect(body.parameters).toEqual({
        format: "wav",
        sample_rate: "16000",
        language_hints: ["zh"]
      });
      expect(result.text).toBe("你好，世界。");
      expect(result.usage).not.toHaveProperty("inputTokens");
      expect(result.usage).not.toHaveProperty("totalTokens");
    }
  );

  it("records only valid provider token counts for newer Ali models", async () => {
    const { service } = await setup(async () =>
      Response.json({
        output: { output: { sentence: { text: "开始。" } } },
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: -1 }
      })
    );
    const settings = voiceSettingsInput();
    settings.profiles[3]!.model = "qwen-audio-3.1-asr-flash";
    await service.saveSettings(settings);
    const result = await service.transcribe(input("aliyun-api"), 11);
    expect(result.usage).toMatchObject({
      model: "qwen-audio-3.1-asr-flash",
      inputTokens: 5,
      outputTokens: 2
    });
    expect(result.usage).not.toHaveProperty("totalTokens");
  });

  it("prefers valid provider billing duration and falls back to WAV for invalid values", async () => {
    const responses = [{ seconds: 2.5 }, { seconds: -1 }, { seconds: 999_999 }];
    const { service } = await setup(async () =>
      Response.json({
        choices: [{ message: { content: "你好。" } }],
        usage: responses.shift()
      })
    );
    const durations = [];
    for (let i = 0; i < 3; i++) {
      const result = await service.transcribe(
        input("mimo-api", `duration-${i}`),
        11
      );
      durations.push(result.usage.durationMs);
    }
    expect(durations).toEqual([2_500, 1_000, 1_000]);
  });

  it("rejects oversized remote responses without retaining their content", async () => {
    const { service } = await setup(async () =>
      Response.json({
        choices: [{ message: { content: "x".repeat(1_000_001) } }]
      })
    );
    await expect(service.transcribe(input(), 11)).rejects.toThrow(
      "超过大小限制"
    );
    await expect(service.getUsage()).resolves.toEqual([]);
  });

  it("binds cancellation to the requesting window and stops a transport that ignores abort", async () => {
    const started = deferred<void>();
    const fetcher = vi
      .fn<VoiceFetcher>()
      .mockImplementation((_url, options) => {
        expect(options?.signal).toBeDefined();
        started.resolve();
        return new Promise(() => undefined);
      });
    const { service } = await setup(fetcher);
    const operation = service.transcribe(input(), 11);
    const rejection = expect(operation).rejects.toThrow("已取消");
    await started.promise;
    expect(service.cancel("voice-request-1", 22)).toBe(false);
    expect(service.cancel("voice-request-1", 11)).toBe(true);
    await rejection;
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    await expect(service.getUsage()).resolves.toEqual([]);
  });

  it("cancels all requests from a closed owner without affecting other owners", async () => {
    const started = deferred<void>();
    let count = 0;
    const { service } = await setup(async () => {
      if (++count === 2) started.resolve();
      return new Promise(() => undefined);
    });
    const first = service.transcribe(input("mimo-api", "first"), 11);
    const second = service.transcribe(input("mimo-api", "second"), 22);
    const firstRejected = expect(first).rejects.toThrow("已取消");
    const secondRejected = expect(second).rejects.toThrow("已取消");
    await started.promise;
    service.cancelOwner(11);
    await firstRejected;
    expect(service.cancel("second", 22)).toBe(true);
    await secondRejected;
  });

  it("times out and never stores failed usage", async () => {
    const { service } = await setup(() => new Promise(() => undefined), 10);
    await expect(service.transcribe(input(), 11)).rejects.toThrow("超时");
    await expect(service.getUsage()).resolves.toEqual([]);
  });

  it.each([401, 403, 429, 500])(
    "does not expose response secrets on HTTP %s",
    async (status) => {
      const { service } = await setup(async () =>
        Response.json({ error: { message: INVALID_VOICE_KEY } }, { status })
      );
      await expect(service.transcribe(input(), 11)).rejects.not.toThrow(
        INVALID_VOICE_KEY
      );
      await expect(service.getUsage()).resolves.toEqual([]);
    }
  );

  it("does not expose transport errors or malformed provider bodies", async () => {
    const fetcher = vi
      .fn<VoiceFetcher>()
      .mockRejectedValueOnce(
        new Error(`network failed with ${INVALID_VOICE_KEY}`)
      )
      .mockResolvedValueOnce(new Response(`{${INVALID_VOICE_KEY}`))
      .mockResolvedValueOnce(Response.json({ error: INVALID_VOICE_KEY }));
    const { service } = await setup(fetcher);
    for (let i = 0; i < 3; i++) {
      await expect(service.transcribe(input(), 11)).rejects.not.toThrow(
        INVALID_VOICE_KEY
      );
    }
    await expect(service.getUsage()).resolves.toEqual([]);
  });

  it("rejects duplicate completed request IDs without another charge", async () => {
    const fetcher = vi
      .fn<VoiceFetcher>()
      .mockImplementation(async () => mimoResponse());
    const { service } = await setup(fetcher);
    await service.transcribe(input(), 11);
    await expect(service.transcribe(input(), 11)).rejects.toThrow("已识别");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retains the saved profile snapshot if settings change during recognition", async () => {
    const started = deferred<void>();
    const response = deferred<Response>();
    const { service } = await setup(async () => {
      started.resolve();
      return response.promise;
    });
    const operation = service.transcribe(input(), 11);
    await started.promise;
    const settings = voiceSettingsInput();
    settings.activeProfileId = "aliyun-api";
    settings.profiles[0]!.model = "changed-asr";
    await service.saveSettings(settings);
    response.resolve(mimoResponse());
    expect((await operation).usage).toMatchObject({
      profileId: "mimo-token-plan",
      model: "mimo-v2.5-asr"
    });
  });

  it("records consumed audio but reports empty transcription as no speech", async () => {
    const { service } = await setup(async () => mimoResponse("  "));
    await expect(service.transcribe(input(), 11)).rejects.toThrow(
      "没有识别到语音"
    );
    expect(await service.getUsage()).toHaveLength(1);
  });

  it("rejects forged WAV metadata before any remote request", async () => {
    const fetcher = vi.fn<VoiceFetcher>();
    const { service } = await setup(fetcher);
    const invalid = voiceWav();
    invalid.writeUInt32LE(48_000, 24);
    await expect(
      service.transcribe(
        { ...input(), audioBase64: invalid.toString("base64") },
        11
      )
    ).rejects.toThrow("16 kHz");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
