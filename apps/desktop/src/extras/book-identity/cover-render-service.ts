import {
  BookCoverCandidateSchema,
  BookIdentityReadCandidateResultSchema,
  BookIdentityRecordSchema,
  CatalogIndexSnapshotSchema,
  LongListBooksResultSchema,
  chatAssistantProjectKey,
  type BookIdentityRenderCoverInput,
  type BookCoverCandidate,
  type ChatAssistantProjectRef
} from "@deepwrite/contracts";
import type { ImageService } from "../../main/image/image-service";
import { safeImageError, SafeImageError } from "../../main/image/image-http";
import { identityCore, type IdentityCore } from "./core-client";
import { CoverCapacity } from "./cover-capacity";
import { buildCoverImagePrompt } from "./cover-image-prompt";

async function currentBookTitle(
  core: IdentityCore,
  book: ChatAssistantProjectRef
): Promise<string> {
  const payload = await identityCore(
    core,
    book.projectType === "long" ? "long.list" : "catalog.index",
    {},
    book
  );
  const books =
    book.projectType === "long"
      ? LongListBooksResultSchema.parse(payload).books
      : CatalogIndexSnapshotSchema.parse(payload).books;
  const current = books.find(
    (entry) =>
      entry.id === book.projectId && entry.bookType === book.projectType
  );
  if (!current)
    throw new SafeImageError("所选作品不存在或暂时不可用，请刷新后重试。");
  return current.title;
}

export class CoverRenderService {
  private readonly capacity = new CoverCapacity();
  private readonly requests = new Map<
    string,
    { ownerId: number; cancelled: boolean }
  >();
  constructor(
    private readonly core: IdentityCore,
    private readonly images: Pick<
      ImageService,
      "render" | "cancel" | "capability"
    >
  ) {}

  async render(
    input: BookIdentityRenderCoverInput,
    ownerId: number
  ): Promise<BookCoverCandidate> {
    if (this.requests.has(input.requestId))
      throw new SafeImageError("这次封面请求正在进行，请等待完成。");
    const pending = { ownerId, cancelled: false };
    const bookKey = chatAssistantProjectKey(input.book);
    let releaseCapacity: (() => void) | undefined;
    this.requests.set(input.requestId, pending);
    try {
      const {
        record: current,
        round,
        candidate
      } = BookIdentityReadCandidateResultSchema.parse(
        await identityCore(
          this.core,
          "bookIdentity.readCandidate",
          {
            book: input.book,
            roundId: input.roundId,
            candidateId: input.candidateId
          },
          input.book
        )
      );
      try {
        if (pending.cancelled) throw new SafeImageError("图片生成已取消。");
        if (current.diagnostics?.foreignBookId)
          throw new SafeImageError("请先继承此作品的设计记录，再生成封面。");
        releaseCapacity = this.capacity.reserve(bookKey, current, round.id);
        const capability = await this.images.capability();
        const prompt = buildCoverImagePrompt(
          candidate,
          round.request.titleRendering,
          round.request.titleRendering === "model"
            ? await currentBookTitle(this.core, input.book)
            : undefined,
          capability?.maxPromptCharacters
        );
        if (pending.cancelled) throw new SafeImageError("图片生成已取消。");
        const result = await this.images.render(
          {
            requestId: input.requestId,
            ...prompt,
            aspectRatio: round.request.aspectRatio
          },
          ownerId
        );
        if (pending.cancelled) throw new SafeImageError("图片生成已取消。");
        const image = result.images[0]!;
        const record = BookIdentityRecordSchema.parse(
          await identityCore(
            this.core,
            "bookIdentity.writeCoverAsset",
            {
              book: input.book,
              roundId: input.roundId,
              candidateId: input.candidateId,
              image: {
                fileBase64: image.png.toString("base64"),
                mimeType: "image/png",
                width: image.width,
                height: image.height,
                thumbBase64: image.thumbnail.toString("base64"),
                imageProfile: result.imageProfile
              }
            },
            input.book
          )
        );
        const updated = record.rounds
          .find((entry) => entry.id === input.roundId)
          ?.candidates.find((entry) => entry.id === input.candidateId);
        this.capacity.observe(bookKey, record);
        return BookCoverCandidateSchema.parse(updated);
      } catch (error) {
        await identityCore(
          this.core,
          "bookIdentity.recordRenderError",
          {
            book: input.book,
            roundId: input.roundId,
            candidateId: input.candidateId,
            error: safeImageError(error)
          },
          input.book
        ).catch(() => undefined);
        throw error;
      }
    } finally {
      releaseCapacity?.();
      this.requests.delete(input.requestId);
    }
  }

  cancel(requestId: string, ownerId: number): boolean {
    const pending = this.requests.get(requestId);
    if (!pending || pending.ownerId !== ownerId) return false;
    pending.cancelled = true;
    this.images.cancel(requestId, ownerId);
    return true;
  }

  cancelOwner(ownerId: number): void {
    for (const [requestId, pending] of this.requests)
      if (pending.ownerId === ownerId) this.cancel(requestId, ownerId);
  }
}
