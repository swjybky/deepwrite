export interface EncodedImageSize {
  width: number;
  height: number;
}

function jpegSize(bytes: Buffer): EncodedImageSize | undefined {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    // Scan data or end of image comes before any frame header we could use.
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = bytes.readUInt16BE(offset + 2);
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrame) {
      if (offset + 9 > bytes.length) return undefined;
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7)
      };
    }
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

function webpSize(bytes: Buffer): EncodedImageSize | undefined {
  if (bytes.length < 30) return undefined;
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X")
    return {
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1
    };
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01)
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff
    };
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1
    };
  }
  return undefined;
}

/** Reads declared pixel size from the header so oversized images are refused before decoding. */
export function encodedImageSize(
  bytes: Buffer,
  mimeType: "image/png" | "image/jpeg" | "image/webp"
): EncodedImageSize | undefined {
  if (mimeType === "image/png")
    return bytes.length >= 24
      ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      : undefined;
  return mimeType === "image/jpeg" ? jpegSize(bytes) : webpSize(bytes);
}
