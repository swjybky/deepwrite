import { deflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** Store without compression, e.g. an EPUB `mimetype`. Defaults to deflate. */
  store?: boolean;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipDateTime(date: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2)
  };
}

/**
 * Builds a standards-compliant ZIP without a runtime dependency. Names carry
 * the UTF-8 flag so Chinese file names survive Finder and Explorer alike.
 */
export function createZip(
  entries: readonly ZipEntry[],
  modifiedAt = new Date()
): Buffer {
  if (entries.length === 0 || entries.length > 0xffff) {
    throw new Error("ZIP entry count is outside the supported range.");
  }
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const { date, time } = zipDateTime(modifiedAt);
  let localOffset = 0;

  for (const entry of entries) {
    if (!entry.name || entry.name.includes("\0")) {
      throw new Error("ZIP entry name is invalid.");
    }
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const method = entry.store ? 0 : 8;
    const content = entry.store ? entry.data : deflateRawSync(entry.data);
    if (content.length > 0xfffffffe || localOffset > 0xfffffffe) {
      throw new Error("ZIP archive is too large.");
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);

    localOffset += local.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

/** Every entry stored uncompressed, as DOCX and EPUB readers expect. */
export function createStoredZip(
  entries: readonly Omit<ZipEntry, "store">[]
): Buffer {
  return createZip(entries.map((entry) => ({ ...entry, store: true })));
}
