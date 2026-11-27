import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  APPEARANCE_CUSTOM_FONT_DISPLAY_NAME_MAX_LENGTH,
  APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES,
  type AppearanceCustomFontFormat,
  type AppearanceFontInstallFailure
} from "@deepwrite/contracts";
import { isNodeError } from "@deepwrite/shared/node";

export interface AppearanceFontCandidate {
  bytes: Buffer;
  byteSize: number;
  displayName: string;
  format: AppearanceCustomFontFormat;
  hash: string;
}

export type AppearanceFontCandidateResult =
  | { ok: true; candidate: AppearanceFontCandidate }
  | { ok: false; failure: AppearanceFontInstallFailure };

function truncate(value: string, maximumLength: number): string {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > maximumLength) break;
    result += character;
  }
  return result;
}

function stripUnsafeCharacters(value: string): string {
  let result = "";
  for (const character of value.normalize("NFC")) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      continue;
    }
    result += character;
  }
  return result.trim();
}

export function safeAppearanceFontFileName(sourcePath: string): string {
  const safe = stripUnsafeCharacters(basename(sourcePath));
  return truncate(
    safe || "未命名字体",
    APPEARANCE_CUSTOM_FONT_DISPLAY_NAME_MAX_LENGTH
  );
}

function safeAppearanceFontDisplayName(sourcePath: string): string {
  const fileName = basename(sourcePath);
  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  const safe = stripUnsafeCharacters(stem);
  return truncate(
    safe || "未命名字体",
    APPEARANCE_CUSTOM_FONT_DISPLAY_NAME_MAX_LENGTH
  );
}

function failure(
  sourcePath: string,
  code: AppearanceFontInstallFailure["code"]
): AppearanceFontCandidateResult {
  return {
    ok: false,
    failure: { displayName: safeAppearanceFontFileName(sourcePath), code }
  };
}

async function readStableBoundedFile(
  handle: Awaited<ReturnType<typeof open>>,
  expectedSize: number
): Promise<Buffer | null> {
  const bytes = Buffer.allocUnsafe(expectedSize + 1);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.read(
      bytes,
      offset,
      bytes.byteLength - offset,
      offset
    );
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  return offset === expectedSize ? bytes.subarray(0, offset) : null;
}

function detectFormat(bytes: Uint8Array): AppearanceCustomFontFormat | null {
  if (bytes.length < 4) return null;
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x54 &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x4f
  ) {
    return "otf";
  }
  if (
    (bytes[0] === 0x00 &&
      bytes[1] === 0x01 &&
      bytes[2] === 0x00 &&
      bytes[3] === 0x00) ||
    (bytes[0] === 0x74 &&
      bytes[1] === 0x72 &&
      bytes[2] === 0x75 &&
      bytes[3] === 0x65)
  ) {
    return "ttf";
  }
  return null;
}

export async function readAppearanceFontCandidate(
  sourcePath: string
): Promise<AppearanceFontCandidateResult> {
  let sourceInfo;
  try {
    sourceInfo = await lstat(sourcePath);
  } catch {
    return failure(sourcePath, "read_failed");
  }
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) {
    return failure(sourcePath, "not_regular_file");
  }

  const requestedFormat = extname(sourcePath).slice(1).toLowerCase();
  if (requestedFormat !== "ttf" && requestedFormat !== "otf") {
    return failure(sourcePath, "unsupported_format");
  }
  if (sourceInfo.size > APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES) {
    return failure(sourcePath, "file_too_large");
  }

  let bytes: Buffer;
  try {
    const handle = await open(
      sourcePath,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile()) {
        return failure(sourcePath, "not_regular_file");
      }
      if (openedInfo.size > APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES) {
        return failure(sourcePath, "file_too_large");
      }
      const stableBytes = await readStableBoundedFile(handle, openedInfo.size);
      if (!stableBytes) {
        return failure(sourcePath, "read_failed");
      }
      bytes = stableBytes;
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    if (isNodeError(error, "ELOOP")) {
      return failure(sourcePath, "not_regular_file");
    }
    return failure(sourcePath, "read_failed");
  }
  if (bytes.byteLength > APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES) {
    return failure(sourcePath, "file_too_large");
  }

  const detectedFormat = detectFormat(bytes);
  if (!detectedFormat || detectedFormat !== requestedFormat) {
    return failure(sourcePath, "invalid_font");
  }
  return {
    ok: true,
    candidate: {
      bytes,
      byteSize: bytes.byteLength,
      displayName: safeAppearanceFontDisplayName(sourcePath),
      format: detectedFormat,
      hash: createHash("sha256").update(bytes).digest("hex")
    }
  };
}

export function disambiguateAppearanceFontName(
  requestedName: string,
  usedNames: ReadonlySet<string>
): string {
  if (!usedNames.has(requestedName)) return requestedName;
  for (let index = 2; ; index += 1) {
    const suffix = ` (${index})`;
    const base = truncate(
      requestedName,
      APPEARANCE_CUSTOM_FONT_DISPLAY_NAME_MAX_LENGTH - suffix.length
    );
    const candidate = `${base}${suffix}`;
    if (!usedNames.has(candidate)) return candidate;
  }
}
