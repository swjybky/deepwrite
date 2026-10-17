import type { BrowserWindow } from "electron";
import type { DeepWriteApi } from "@deepwrite/contracts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

type VoiceUiStep =
  "settings" | "chat-recording" | "chat-transcribing" | "chat-finish";

/** Serialized into the real Renderer; Chromium supplies the smoke microphone. */
async function voiceUiStep(step: VoiceUiStep) {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const pause = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  const ensure = (condition: unknown, message: string): void => {
    if (!condition) throw new Error(`Voice UI smoke: ${message}`);
  };
  async function until<T>(
    read: () => T,
    label: string
  ): Promise<NonNullable<T>> {
    // Cold CI runners mount the settings UI much slower than dev machines;
    // give each step enough room while still bounding a broken UI.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      document
        .querySelector<HTMLButtonElement>(".startup-alert-close")
        ?.click();
      const value = read();
      if (value) return value as NonNullable<T>;
      await pause(40);
    }
    const feedback = [...document.querySelectorAll(".toast-message__content")]
      .map((node) => node.textContent?.trim())
      .join("; ");
    const recorderStatus = document
      .querySelector(".voice-status")
      ?.textContent?.trim();
    throw new Error(
      `Voice UI smoke timed out: ${label}${feedback ? ` (${feedback})` : ""}${recorderStatus ? ` [${recorderStatus}; ${document.visibilityState}]` : ""}`
    );
  }
  const selector = <T extends Element = HTMLElement>(value: string) =>
    document.querySelector<T>(value);
  async function click(value: string): Promise<void> {
    const button = await until(() => {
      const node = selector<HTMLButtonElement>(value);
      return node && !node.disabled ? node : null;
    }, value);
    button.scrollIntoView({ block: "center", inline: "nearest" });
    button.click();
  }
  async function buttonText(root: string, text: string): Promise<void> {
    const button = await until(
      () =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(`${root} button`)
        ].find((node) => !node.disabled && node.textContent?.trim() === text),
      text
    );
    button.scrollIntoView({ block: "center", inline: "nearest" });
    button.click();
  }
  async function waitForRecording(root: string): Promise<void> {
    await until(
      () => selector(`${root} .voice-input-bar.is-recording`),
      "recording state"
    );
    await until(() => {
      const status = selector(`${root} .voice-status`)?.textContent ?? "";
      return /0:0[1-9] \/ 10:00/u.test(status);
    }, "microphone produced audio samples");
    ensure(
      document.visibilityState === "visible",
      "recording window is hidden"
    );
    ensure(
      document.querySelectorAll(`${root} .voice-wave span`).length > 10,
      "waveform missing"
    );
  }

  if (step === "settings") {
    const before = (await api.voice.getUsage()).map(
      (record) => record.requestId
    );
    if (!selector(".settings-page")) {
      if (!selector("#account-menu")) await click(".account-identity-button");
      await click('#account-menu button[role="menuitem"]:first-child');
    }
    await buttonText(".settings-nav", "语音模型");
    await until(() => {
      return [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".settings-content button"
        )
      ].some(
        (button) =>
          !button.disabled && button.textContent?.trim() === "开始录音测试"
      );
    }, "voice settings loaded");
    ensure(
      selector('.voice-usage[aria-labelledby="voice-usage-title"]'),
      "independent usage panel missing"
    );
    await buttonText(".settings-content", "开始录音测试");
    await waitForRecording(".settings-content");
    await click('.settings-content button[aria-label="停止录音并识别"]');
    await until(
      () =>
        selector<HTMLTextAreaElement>(
          '[aria-label="语音识别测试结果"]'
        )?.value.includes("语音输入测试"),
      "settings transcription"
    );
    ensure(
      !selector(".settings-content .voice-input-bar"),
      "test recorder did not return to idle"
    );
    const after = (await api.voice.getUsage()).map(
      (record) => record.requestId
    );
    ensure(
      after.filter((requestId) => !before.includes(requestId)).length === 1,
      "settings transcription was not recorded in voice usage"
    );
    return { usage: after };
  }

  const root = ".chat-assistant-composer";
  if (step === "chat-recording") {
    await click(".settings-back");
    const more = await until(
      () => selector<HTMLButtonElement>('button[data-nav-id="more"]'),
      "more features"
    );
    if (more.getAttribute("aria-expanded") !== "true") more.click();
    await click('button[data-feature-id="chat-assistant"]');
    const input = await until(() => {
      const node = selector<HTMLTextAreaElement>(`${root} textarea`);
      return node && !node.disabled ? node : null;
    }, "chat composer");
    input.value = "保留原草稿";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    await pause(0);
    await click(`${root} button[aria-label="语音输入"]`);
    await waitForRecording(root);
    ensure(
      selector<HTMLTextAreaElement>(`${root} textarea`)?.value === "保留原草稿",
      "recording replaced draft"
    );
    return {
      usage: (await api.voice.getUsage()).map((record) => record.requestId)
    };
  }

  if (step === "chat-transcribing") {
    const before = (await api.voice.getUsage()).map(
      (record) => record.requestId
    );
    await click(`${root} button[aria-label="取消语音输入"]`);
    await until(
      () => selector(`${root} button[aria-label="语音输入"]`),
      "cancel returned to idle"
    );
    ensure(
      selector<HTMLTextAreaElement>(`${root} textarea`)?.value === "保留原草稿",
      "cancel changed draft"
    );
    ensure(
      JSON.stringify(
        (await api.voice.getUsage()).map((record) => record.requestId)
      ) === JSON.stringify(before),
      "cancel submitted audio"
    );
    const settings = await api.voice.getSettings();
    await api.voice.saveSettings({
      ...settings,
      profiles: settings.profiles.map(({ hasApiKey: _hasKey, ...profile }) => ({
        ...profile,
        model:
          profile.id === settings.activeProfileId
            ? "smoke-ui-delay"
            : profile.model
      }))
    });
    await click(`${root} button[aria-label="语音输入"]`);
    await waitForRecording(root);
    await click(`${root} button[aria-label="停止录音并识别"]`);
    await until(
      () =>
        selector(`${root} .voice-transcribing-label`)?.textContent?.trim() ===
        "正在转写",
      "transcribing label"
    );
    ensure(selector(`${root} .voice-spinner`), "transcribing spinner missing");
    const wave = selector<HTMLElement>(`${root} .voice-wave`);
    ensure(
      !wave ||
        wave.getClientRects().length === 0 ||
        getComputedStyle(wave).visibility === "hidden",
      "stale waveform visible while transcribing"
    );
    const cancel = selector<HTMLButtonElement>(
      `${root} button[aria-label="取消语音输入"]`
    );
    ensure(cancel && !cancel.disabled, "transcription cannot be cancelled");
    return { usage: before };
  }
  await until(
    () =>
      selector<HTMLTextAreaElement>(`${root} textarea`)?.value.includes(
        "语音输入测试"
      ),
    "chat transcription"
  );
  const value = selector<HTMLTextAreaElement>(`${root} textarea`)!.value;
  ensure(value.startsWith("保留原草稿"), "transcription lost existing draft");
  ensure(
    !selector(`${root} .voice-input-bar`),
    "chat recorder did not return to idle"
  );
  const after = (await api.voice.getUsage()).map((record) => record.requestId);
  return { usage: after };
}

export async function runVoiceUiSmoke(window: BrowserWindow) {
  if (process.env.DEEPWRITE_SMOKE !== "1")
    throw new Error("Voice UI smoke requires the isolated smoke profile.");
  window.showInactive();
  const run = (step: VoiceUiStep) =>
    window.webContents.executeJavaScript(
      `(${voiceUiStep.toString()})(${JSON.stringify(step)})`,
      true
    ) as Promise<{ usage: string[] }>;
  const settings = await run("settings");
  await window.webContents.executeJavaScript(
    `document.querySelector('.settings-content').scrollIntoView({block:'start'});`
  );
  await writeFile(
    join(tmpdir(), "deepwrite-voice-settings.png"),
    (await window.capturePage()).toPNG()
  );
  const recording = await run("chat-recording");
  await writeFile(
    join(tmpdir(), "deepwrite-voice-recording.png"),
    (await window.capturePage()).toPNG()
  );
  const transcribing = await run("chat-transcribing");
  await writeFile(
    join(tmpdir(), "deepwrite-voice-transcribing.png"),
    (await window.capturePage()).toPNG()
  );
  const finished = await run("chat-finish");
  const unchanged = (current: string[]) =>
    JSON.stringify(current) === JSON.stringify(settings.usage);
  if (
    !unchanged(recording.usage) ||
    !unchanged(transcribing.usage) ||
    finished.usage.filter((requestId) => !settings.usage.includes(requestId))
      .length !== 1
  )
    throw new Error(
      "Voice UI smoke: unexpected usage change between UI steps."
    );
  return {
    status: "ok",
    settingsTest: true,
    chatDraft: true,
    cancelled: true,
    transcribing: true
  };
}
