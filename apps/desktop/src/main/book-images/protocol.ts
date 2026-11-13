import { verifyBookImageHandle } from "./verify-file";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { protocol } from "electron";
import {
  BOOK_IMAGE_MAX_BYTES,
  BookImagesResolveInputSchema,
  BookImagesResolveResultSchema,
  type ChatAssistantProjectRef,
  type BookImagesResolveResult
} from "@deepwrite/contracts";
import { bookImageCore, type BookImageCore } from "./core-client";

export const BOOK_IMAGE_PROTOCOL_SCHEME = "deepwrite-book-image";
export function registerBookImageScheme(
  registrar: Pick<typeof protocol, "registerSchemesAsPrivileged"> = protocol
): void {
  registrar.registerSchemesAsPrivileged([
    {
      scheme: BOOK_IMAGE_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ]);
}
export type BookImageAssetResolver = (
  book: ChatAssistantProjectRef,
  path: string
) => Promise<BookImagesResolveResult>;
export function createBookImageProtocolHandler(
  resolveAsset: BookImageAssetResolver,
  openAsset: (path: string, flags: number) => Promise<FileHandle> = open
): (request: Request) => Promise<Response> {
  let active = 0;
  const waiting: {
    request: Request;
    ready: (acquired: boolean) => void;
    abort: () => void;
  }[] = [];
  const acquire = (request: Request): Promise<boolean> => {
    if (request.signal.aborted) return Promise.resolve(false);
    if (active < 8) {
      active += 1;
      return Promise.resolve(true);
    }
    return new Promise((ready) => {
      const entry = {
        request,
        ready,
        abort: () => {
          const index = waiting.indexOf(entry);
          if (index >= 0) waiting.splice(index, 1);
          ready(false);
        }
      };
      waiting.push(entry);
      request.signal.addEventListener("abort", entry.abort, { once: true });
    });
  };
  const releaseSlot = () => {
    const next = waiting.shift();
    if (next) {
      next.request.signal.removeEventListener("abort", next.abort);
      next.ready(true);
    } else active -= 1;
  };
  return async (request) => {
    if (request.method !== "GET")
      return new Response(null, { status: 405, headers: { Allow: "GET" } });
    let input;
    try {
      const url = new URL(request.url);
      if (
        url.protocol !== `${BOOK_IMAGE_PROTOCOL_SCHEME}:` ||
        url.hostname !== "asset" ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        /(?:%2e|%2f|%5c|\.\.)/iu.test(request.url)
      )
        throw new Error("invalid URL");
      const parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
      if (parts.length !== 3) throw new Error("invalid URL");
      input = BookImagesResolveInputSchema.parse({
        book: { projectType: parts[0], projectId: parts[1] },
        path: `images/${parts[2]}`
      });
    } catch {
      return new Response(null, { status: 400 });
    }
    if (!(await acquire(request))) return new Response(null, { status: 499 });
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        releaseSlot();
      }
    };
    let handle: FileHandle | undefined;
    try {
      const asset = BookImagesResolveResultSchema.parse(
        await resolveAsset(input.book, input.path)
      );
      handle = await openAsset(
        asset.path,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      await verifyBookImageHandle(asset, handle);
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.size !== asset.byteSize ||
        stat.size <= 0 ||
        stat.size > BOOK_IMAGE_MAX_BYTES ||
        request.signal.aborted
      )
        throw new Error("invalid image");
      const stream = handle.createReadStream({
        autoClose: true,
        start: 0,
        end: stat.size - 1
      });
      handle = undefined;
      const abort = () => stream.destroy();
      request.signal.addEventListener("abort", abort, { once: true });
      stream.once("close", () => {
        request.signal.removeEventListener("abort", abort);
        release();
      });
      return new Response(
        Readable.toWeb(stream) as ReadableStream<Uint8Array>,
        {
          headers: {
            "Content-Type": asset.mimeType,
            "Content-Length": String(asset.byteSize),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff"
          }
        }
      );
    } catch {
      await handle?.close().catch(() => undefined);
      release();
      return new Response(null, { status: 404 });
    }
  };
}
export function installBookImageProtocolHandler(
  core: BookImageCore,
  installer: Pick<typeof protocol, "handle"> = protocol
): void {
  installer.handle(
    BOOK_IMAGE_PROTOCOL_SCHEME,
    createBookImageProtocolHandler(async (book, path) =>
      BookImagesResolveResultSchema.parse(
        await bookImageCore(core, "bookImages.resolve", { book, path }, book)
      )
    )
  );
}
