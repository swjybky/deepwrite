import { describe, expect, it } from "vitest";
import source from "./ZhuqueDetectionPage.vue?raw";

describe("ZhuqueDetectionPage", () => {
  it("embeds the Tencent detector in an isolated persistent webview", () => {
    expect(source).toContain(
      'const ZHUQUE_DETECTION_URL = "https://matrix.tencent.com/ai-detect/"'
    );
    expect(source).toContain('partition="persist:zhuque-detection"');
    expect(source).toContain("<webview");
  });
});
