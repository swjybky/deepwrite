import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 2: 3, 6: 4 };

/** 8-bit RGB/RGBA, non-interlaced: what Chromium screenshots produce. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE))
    throw new Error("不是 PNG 文件");
  let offset = 8;
  let header;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12]
      };
    } else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = CHANNELS[header?.colorType];
  if (!header || header.depth !== 8 || !channels || header.interlace !== 0) {
    throw new Error("只支持 8 位 RGB/RGBA 非交错 PNG");
  }
  const raw = inflateSync(Buffer.concat(data));
  const { width, height } = header;
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    );
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const a = Math.abs(estimate - left);
        const b = Math.abs(estimate - up);
        const c = Math.abs(estimate - upLeft);
        value += a <= b && a <= c ? left : b <= c ? up : upLeft;
      }
      line[x] = value & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      pixels[target] = line[x * channels];
      pixels[target + 1] = line[x * channels + 1];
      pixels[target + 2] = line[x * channels + 2];
      pixels[target + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    previous = line;
  }
  return { width, height, pixels };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

export function encodePng({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    pixels.copy(
      raw,
      y * (width * 4 + 1) + 1,
      y * width * 4,
      (y + 1) * width * 4
    );
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/**
 * Counts pixels whose channels differ by more than `tolerance` (anti-aliasing
 * noise), and paints them red over a faded copy of the first image.
 */
export function diffImages(a, b, tolerance = 16) {
  if (a.width !== b.width || a.height !== b.height) {
    return {
      sameSize: false,
      sizes: [
        [a.width, a.height],
        [b.width, b.height]
      ]
    };
  }
  const out = Buffer.alloc(a.pixels.length);
  let changed = 0;
  let box;
  for (let index = 0; index < a.pixels.length; index += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      delta = Math.max(
        delta,
        Math.abs(a.pixels[index + channel] - b.pixels[index + channel])
      );
    }
    if (delta > tolerance) {
      changed += 1;
      out[index] = 255;
      out[index + 1] = 0;
      out[index + 2] = 0;
      out[index + 3] = 255;
      const pixel = index / 4;
      const x = pixel % a.width;
      const y = Math.floor(pixel / a.width);
      box = box
        ? [
            Math.min(box[0], x),
            Math.min(box[1], y),
            Math.max(box[2], x),
            Math.max(box[3], y)
          ]
        : [x, y, x, y];
    } else {
      const gray =
        (a.pixels[index] + a.pixels[index + 1] + a.pixels[index + 2]) / 3;
      const faded = Math.round(255 - (255 - gray) * 0.25);
      out[index] = faded;
      out[index + 1] = faded;
      out[index + 2] = faded;
      out[index + 3] = 255;
    }
  }
  return {
    sameSize: true,
    changedPixels: changed,
    ratio: changed / (a.width * a.height),
    changedBox: box && {
      x: box[0],
      y: box[1],
      width: box[2] - box[0] + 1,
      height: box[3] - box[1] + 1
    },
    diff: { width: a.width, height: a.height, pixels: out }
  };
}

/** Crops a CSS-pixel box out of a device-pixel image; undefined when outside. */
export function cropImage(image, box, scale = 1) {
  const left = Math.max(0, Math.floor(box.x * scale));
  const top = Math.max(0, Math.floor(box.y * scale));
  const right = Math.min(image.width, Math.ceil((box.x + box.width) * scale));
  const bottom = Math.min(
    image.height,
    Math.ceil((box.y + box.height) * scale)
  );
  if (right <= left || bottom <= top) return undefined;
  const width = right - left;
  const height = bottom - top;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const start = ((top + y) * image.width + left) * 4;
    image.pixels.copy(pixels, y * width * 4, start, start + width * 4);
  }
  return { width, height, pixels };
}
