import type { NativeImage } from "electron";
import type { ImageModelSettingsInput } from "@deepwrite/contracts";
import type { ImageDecoder } from "./image-download";
import { testSecureStorage } from "../voice/voice-test-support";

export { testSecureStorage };
export const INVALID_IMAGE_KEY = "invalid-test-image-key";
export const IMAGE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH0cAAAAASUVORK5CYII=",
  "base64"
);

export function imageSettingsInput(): ImageModelSettingsInput {
  return {
    activeProfileId: "img_test",
    profiles: [
      {
        id: "img_test",
        presetId: "volcengine-seedream",
        name: "测试图片",
        baseUrl: "https://image.example.test/v1",
        model: "invalid-test-image-model",
        defaultAspectRatio: "3:4",
        apiKey: INVALID_IMAGE_KEY
      }
    ]
  };
}

export const testImageDecoder: ImageDecoder = () =>
  ({
    isEmpty: () => false,
    getSize: () => ({ width: 600, height: 800 }),
    toPNG: () => IMAGE_PNG,
    resize: () => ({ toJPEG: () => Buffer.from([255, 216, 255, 217]) })
  }) as unknown as NativeImage;

export function imageResponse(): Response {
  return Response.json({ data: [{ b64_json: IMAGE_PNG.toString("base64") }] });
}
