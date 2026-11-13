import { describe, expect, it } from "vitest";
import { encodedImageSize } from "./dimensions";

function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.set([0xff, 0xc2, 0x00, 0x11, 0x08]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function webp(chunk: string, body: Buffer): Buffer {
  const header = Buffer.alloc(20);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(12 + body.length, 4);
  header.write("WEBP", 8, "ascii");
  header.write(chunk, 12, "ascii");
  header.writeUInt32LE(body.length, 16);
  return Buffer.concat([header, body]);
}

describe("encoded image size", () => {
  it("reads PNG, progressive JPEG and the three WebP layouts before decoding", () => {
    const png = Buffer.alloc(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.writeUInt32BE(9000, 16);
    png.writeUInt32BE(20, 20);
    expect(encodedImageSize(png, "image/png")).toEqual({
      width: 9000,
      height: 20
    });
    expect(encodedImageSize(jpeg(12000, 9000), "image/jpeg")).toEqual({
      width: 12000,
      height: 9000
    });

    const extended = Buffer.alloc(10);
    extended.writeUIntLE(16383, 4, 3);
    extended.writeUIntLE(99, 7, 3);
    expect(encodedImageSize(webp("VP8X", extended), "image/webp")).toEqual({
      width: 16384,
      height: 100
    });
    const lossy = Buffer.alloc(10);
    lossy.set([0x9d, 0x01, 0x2a], 3);
    lossy.writeUInt16LE(640, 6);
    lossy.writeUInt16LE(480, 8);
    expect(encodedImageSize(webp("VP8 ", lossy), "image/webp")).toEqual({
      width: 640,
      height: 480
    });
    const lossless = Buffer.alloc(10);
    lossless[0] = 0x2f;
    lossless.writeUInt32LE(((300 - 1) << 14) | (200 - 1), 1);
    expect(encodedImageSize(webp("VP8L", lossless), "image/webp")).toEqual({
      width: 200,
      height: 300
    });
  });

  it("returns undefined for truncated or unrecognised headers", () => {
    expect(encodedImageSize(Buffer.from([0xff, 0xd8]), "image/jpeg")).toBe(
      undefined
    );
    expect(
      encodedImageSize(
        Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]),
        "image/jpeg"
      )
    ).toBe(undefined);
    expect(encodedImageSize(webp("ALPH", Buffer.alloc(10)), "image/webp")).toBe(
      undefined
    );
  });
});
