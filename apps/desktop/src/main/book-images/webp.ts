import { BrowserWindow } from "electron";
import { createId } from "@deepwrite/shared";
import {
  BOOK_IMAGE_MAX_BYTES,
  BOOK_IMAGE_MAX_DIMENSION
} from "@deepwrite/contracts";
import { BookImageError } from "./errors";
import { identifyImage } from "../image/image-download";

const DECODE_TIMEOUT_MS = 20_000;
const DECODER_HTML =
  "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'\">";

// This function runs only inside the disposable sandbox, with image bytes as its sole input.
async function rasterizeWebp(
  base64: string,
  maximum: number,
  encodedLimit: number
) {
  const image = new Image();
  image.src = `data:image/webp;base64,${base64}`;
  try {
    await image.decode();
  } catch {
    return { error: "invalid" };
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width < 1 || height < 1 || Math.max(width, height) > maximum)
    return { error: "dimensions" };
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return { error: "invalid" };
  context.drawImage(image, 0, 0);
  const png = canvas.toDataURL("image/png");
  if (png.length > encodedLimit + "data:image/png;base64,".length)
    return { error: "too_large" };
  return { png: png.slice("data:image/png;base64,".length), width, height };
}

export type WebpConverter = (bytes: Buffer) => Promise<Buffer>;
export const decodeWebpToPng: WebpConverter = async (bytes) => {
  if (identifyImage(bytes) !== "image/webp")
    throw new BookImageError(
      "book_image.unsupported_format",
      "图片不是 WebP 格式。"
    );
  const window = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      partition: createId("book_image_decoder"),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      devTools: false,
      webviewTag: false
    }
  });
  const contents = window.webContents;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectDecode!: (error: Error) => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectDecode = reject;
  });
  const onGone = () =>
    rejectDecode(
      new BookImageError("book_image.invalid_dimensions", "图片无法解码。")
    );
  try {
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.setPermissionRequestHandler(
      (_sender, _permission, callback) => callback(false)
    );
    contents.session.webRequest.onBeforeRequest(
      { urls: ["<all_urls>"] },
      (details, callback) =>
        callback({ cancel: !details.url.startsWith("data:") })
    );
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.once("render-process-gone", onGone);
    window.once("closed", onGone);
    timer = setTimeout(onGone, DECODE_TIMEOUT_MS);
    const decoded = await Promise.race([
      (async () => {
        await window.loadURL(
          `data:text/html;charset=UTF-8,${encodeURIComponent(DECODER_HTML)}`
        );
        return contents.executeJavaScript(
          `(${rasterizeWebp.toString()})(${JSON.stringify(bytes.toString("base64"))},${BOOK_IMAGE_MAX_DIMENSION},${Math.ceil(BOOK_IMAGE_MAX_BYTES / 3) * 4})`
        ) as Promise<unknown>;
      })(),
      interrupted
    ]);
    if (!decoded || typeof decoded !== "object")
      throw new Error("invalid decoder response");
    const result = decoded as {
      error?: unknown;
      png?: unknown;
      width?: unknown;
      height?: unknown;
    };
    if (result.error === "too_large")
      throw new BookImageError(
        "book_image.too_large",
        "图片转换后超过 20 MB。"
      );
    if (
      result.error ||
      typeof result.png !== "string" ||
      typeof result.width !== "number" ||
      typeof result.height !== "number" ||
      !Number.isInteger(result.width) ||
      !Number.isInteger(result.height) ||
      result.width < 1 ||
      result.height < 1 ||
      Math.max(result.width, result.height) > BOOK_IMAGE_MAX_DIMENSION
    )
      throw new BookImageError(
        "book_image.invalid_dimensions",
        "图片无法解码或尺寸无效。"
      );
    if (result.png.length > Math.ceil(BOOK_IMAGE_MAX_BYTES / 3) * 4)
      throw new BookImageError(
        "book_image.too_large",
        "图片转换后超过 20 MB。"
      );
    if (
      result.png.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(result.png)
    )
      throw new Error("invalid decoder bytes");
    const png = Buffer.from(result.png, "base64");
    if (png.length > BOOK_IMAGE_MAX_BYTES)
      throw new BookImageError(
        "book_image.too_large",
        "图片转换后超过 20 MB。"
      );
    if (
      identifyImage(png) !== "image/png" ||
      png.length < 24 ||
      png.readUInt32BE(16) !== result.width ||
      png.readUInt32BE(20) !== result.height
    )
      throw new Error("invalid decoder PNG");
    return png;
  } catch (error) {
    if (error instanceof BookImageError) throw error;
    throw new BookImageError(
      "book_image.invalid_dimensions",
      "图片无法解码或尺寸无效。"
    );
  } finally {
    clearTimeout(timer);
    contents.removeListener("render-process-gone", onGone);
    window.removeListener("closed", onGone);
    if (!window.isDestroyed()) window.destroy();
  }
};
