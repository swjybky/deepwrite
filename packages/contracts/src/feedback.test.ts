import { describe, expect, it } from "vitest";
import {
  FEEDBACK_IMAGE_MAX_BYTES,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_TOTAL_IMAGE_MAX_BYTES,
  FeedbackImageSchema,
  FeedbackSubmitInputSchema,
  feedbackImageByteLength,
  feedbackImagesTotalBytes
} from "./feedback";

describe("feedback contracts", () => {
  it("exposes the updated attachment limits", () => {
    expect(FEEDBACK_MAX_IMAGES).toBe(6);
    expect(FEEDBACK_IMAGE_MAX_BYTES).toBe(1_400_000);
    expect(FEEDBACK_TOTAL_IMAGE_MAX_BYTES).toBe(20_000_000);
  });

  it("measures decoded base64 byte lengths accurately", () => {
    expect(feedbackImageByteLength("")).toBe(0);
    expect(feedbackImageByteLength("   ")).toBe(0);
    expect(feedbackImageByteLength("QQ==")).toBe(1);
    expect(feedbackImageByteLength("QUI=")).toBe(2);
    expect(feedbackImageByteLength("QUJD")).toBe(3);

    const exactSingleLimitBase64 = `${"A".repeat(1_866_667)}=`;
    expect(feedbackImageByteLength(exactSingleLimitBase64)).toBe(
      FEEDBACK_IMAGE_MAX_BYTES
    );

    expect(
      feedbackImagesTotalBytes(["QQ==", "QUI=", "QUJD", exactSingleLimitBase64])
    ).toBe(1 + 2 + 3 + FEEDBACK_IMAGE_MAX_BYTES);

    const sevenMbBase64 = "A".repeat(9_333_336);
    expect(
      feedbackImagesTotalBytes([sevenMbBase64, sevenMbBase64, sevenMbBase64])
    ).toBeGreaterThan(FEEDBACK_TOTAL_IMAGE_MAX_BYTES);
  });

  it("validates 4 to 6 valid images and rejects 7 or oversized single images", () => {
    for (const count of [4, 5, 6]) {
      const images = Array.from({ length: count }, () => "QUJD");
      expect(
        FeedbackSubmitInputSchema.safeParse({
          content: "多图测试",
          images
        }).success
      ).toBe(true);
    }

    expect(
      FeedbackSubmitInputSchema.safeParse({
        content: "七张图",
        images: Array.from({ length: 7 }, () => "QUJD")
      }).success
    ).toBe(false);

    const overSingleLimitBase64 = "A".repeat(1_866_668);
    expect(
      FeedbackSubmitInputSchema.safeParse({
        content: "单图超限",
        images: [overSingleLimitBase64]
      }).success
    ).toBe(false);

    expect(
      FeedbackSubmitInputSchema.safeParse({
        content: "非法 base64",
        images: ["not*base64"]
      }).success
    ).toBe(false);
  });

  it("validates accepted feedback image MIME types", () => {
    for (const contentType of [
      "image/png",
      "image/jpeg",
      "image/webp"
    ] as const) {
      expect(
        FeedbackImageSchema.safeParse({ contentType, data: "QUJD" }).success
      ).toBe(true);
    }
    expect(
      FeedbackImageSchema.safeParse({
        contentType: "image/svg+xml",
        data: "QUJD"
      }).success
    ).toBe(false);
  });
});
