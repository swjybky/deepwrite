import {
  FEEDBACK_PAGE_SIZE,
  FeedbackImageSchema,
  FeedbackImageTargetSchema,
  FeedbackItemSchema,
  FeedbackListFilterSchema,
  FeedbackPageSchema,
  FeedbackSubmitInputSchema,
  type FeedbackImage,
  type FeedbackImageTarget,
  type FeedbackItem,
  type FeedbackListFilter,
  type FeedbackPage,
  type FeedbackSubmitInput
} from "@deepwrite/contracts";
import type { MarketplaceRequestOptions } from "../../main/marketplace-request";
import {
  asRecord,
  MarketplaceClientError,
  requiredNumber,
  requiredString
} from "../../main/marketplace-response";

const FEEDBACK_PATH = "/market/v1/me/feedback";
/** Screenshots upload and download far slower than the usual small JSON. */
const FEEDBACK_SUBMIT_TIMEOUT_MS = 60_000;
const FEEDBACK_IMAGE_TIMEOUT_MS = 30_000;

/** The skill marketplace account client: its session signs every request. */
export interface FeedbackRequester {
  request(
    method: string,
    path: string,
    options: MarketplaceRequestOptions
  ): Promise<unknown>;
}

export interface FeedbackClientInfo {
  version: string;
  platform: string;
}

function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error: unknown) {
    throw new MarketplaceClientError(
      "marketplace.invalid_response",
      "反馈服务返回了无效数据。",
      undefined,
      { cause: error }
    );
  }
}

function normalizeItem(raw: unknown): FeedbackItem {
  const value = asRecord(raw, "反馈");
  const images = Array.isArray(value.images) ? value.images : [];
  return FeedbackItemSchema.parse({
    id: value.id,
    ...(value.tag ? { tag: value.tag } : {}),
    content: value.content,
    status: value.status,
    reply: value.reply,
    ...(value.replied_at ? { repliedAt: value.replied_at } : {}),
    images: images.map((image: unknown) => {
      const info = asRecord(image, "反馈截图");
      return {
        id: info.id,
        contentType: info.content_type,
        byteSize: info.byte_size
      };
    }),
    createdAt: value.created_at,
    updatedAt: value.updated_at
  });
}

export class FeedbackClient {
  constructor(
    private readonly requester: FeedbackRequester,
    private readonly info: FeedbackClientInfo
  ) {}

  async submit(input: FeedbackSubmitInput): Promise<FeedbackItem> {
    const { tag, content, images } = FeedbackSubmitInputSchema.parse(input);
    const raw = await this.requester.request("POST", FEEDBACK_PATH, {
      authenticated: true,
      timeoutMs: FEEDBACK_SUBMIT_TIMEOUT_MS,
      body: {
        tag: tag ?? "",
        content,
        images,
        client_version: this.info.version,
        client_platform: this.info.platform
      }
    });
    return parsed(() => normalizeItem(raw));
  }

  async list(filter: FeedbackListFilter = {}): Promise<FeedbackPage> {
    const { page } = FeedbackListFilterSchema.parse(filter);
    const query = new URLSearchParams({
      page: String(page ?? 1),
      page_size: String(FEEDBACK_PAGE_SIZE)
    });
    const raw = await this.requester.request(
      "GET",
      `${FEEDBACK_PATH}?${query.toString()}`,
      { authenticated: true }
    );
    return parsed(() => {
      const value = asRecord(raw, "反馈列表");
      return FeedbackPageSchema.parse({
        items: (Array.isArray(value.items) ? value.items : []).map(
          normalizeItem
        ),
        page: requiredNumber(value, "page"),
        pageSize: requiredNumber(value, "page_size"),
        total: requiredNumber(value, "total"),
        totalPages: requiredNumber(value, "total_pages")
      });
    });
  }

  async image(target: FeedbackImageTarget): Promise<FeedbackImage> {
    const { feedbackId, imageId } = FeedbackImageTargetSchema.parse(target);
    const raw = await this.requester.request(
      "GET",
      `${FEEDBACK_PATH}/${encodeURIComponent(feedbackId)}/images/${encodeURIComponent(imageId)}`,
      { authenticated: true, timeoutMs: FEEDBACK_IMAGE_TIMEOUT_MS }
    );
    return parsed(() => {
      const value = asRecord(raw, "反馈截图");
      return FeedbackImageSchema.parse({
        contentType: requiredString(value, "content_type"),
        data: requiredString(value, "data")
      });
    });
  }
}
