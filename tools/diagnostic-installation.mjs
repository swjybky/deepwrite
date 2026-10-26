import nodeFs from "node:fs";
import { createRequire } from "node:module";

let fs = nodeFs;
try {
  // Electron treats ASAR files as directories; inspect the raw archive instead.
  fs = createRequire(import.meta.url)("original-fs");
} catch {
  // Ordinary Node.js does not provide Electron's original-fs module.
}

function readArchiveEntry(archive, entry) {
  const descriptor = fs.openSync(archive, "r");
  try {
    const total = fs.fstatSync(descriptor).size;
    const size = Buffer.alloc(8);
    if (fs.readSync(descriptor, size, 0, 8, 0) !== 8)
      throw new Error("Invalid archive");
    const headerSize = size.readUInt32LE(4);
    if (
      headerSize < 8 ||
      headerSize > 16 * 1024 * 1024 ||
      headerSize + 8 > total
    )
      throw new Error("Invalid archive header");
    const header = Buffer.alloc(headerSize);
    if (fs.readSync(descriptor, header, 0, headerSize, 8) !== headerSize)
      throw new Error("Truncated archive header");
    const jsonSize = header.readUInt32LE(4);
    if (jsonSize > headerSize - 8)
      throw new Error("Invalid archive header length");
    let file = JSON.parse(header.subarray(8, 8 + jsonSize).toString("utf8"));
    for (const name of entry.split("/")) {
      if (!name || name === "." || name === "..")
        throw new Error("Invalid entry");
      file = file?.files?.[name];
    }
    const offset = Number(file?.offset);
    if (
      !file ||
      file.link ||
      file.unpacked ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > 16 * 1024 * 1024 ||
      8 + headerSize + offset + file.size > total
    )
      throw new Error("Invalid archive entry");
    const data = Buffer.alloc(file.size);
    if (
      fs.readSync(descriptor, data, 0, data.length, 8 + headerSize + offset) !==
      data.length
    )
      throw new Error("Truncated archive entry");
    return data.toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

function inspectArchive(archive) {
  const metadata = JSON.parse(readArchiveEntry(archive, "package.json"));
  const version = /^\d+\.\d+\.\d+$/u.test(metadata.version)
    ? metadata.version
    : "unknown";
  const main = readArchiveEntry(archive, "out/main/index.js");
  const matches = [
    ...main.matchAll(
      /"MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL"\s*:\s*("(?:\\.|[^"\\])*")/gu
    )
  ];
  const values = [...new Set(matches.map((match) => JSON.parse(match[1])))];
  if (values.length !== 1) return { version, configured: false };
  try {
    const baseUrl = new URL(values[0]);
    if (
      !["https:", "http:"].includes(baseUrl.protocol) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash ||
      baseUrl.hostname.endsWith(".invalid")
    )
      return { version, configured: false };
    return { version, configured: true, baseUrl };
  } catch {
    return { version, configured: false };
  }
}

export { readArchiveEntry, inspectArchive };
