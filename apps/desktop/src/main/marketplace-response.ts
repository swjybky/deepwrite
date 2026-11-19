import {
  MarketplaceContentDetailSchema,
  MarketplaceContentPageSchema,
  MarketplaceContentSummarySchema,
  MarketplaceMaterialDetailSchema,
  MarketplaceMaterialSummarySchema,
  MarketplaceUserSchema,
  type MarketplaceContentDetail,
  type MarketplaceContentPage,
  type MarketplaceContentRef,
  type MarketplaceContentSummary,
  type MarketplaceMaterialDetail,
  type MarketplaceMaterialSummary,
  type MarketplaceSkillDetail,
  type MarketplaceUser
} from "@deepwrite/contracts";

export class MarketplaceClientError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(
    code: string,
    message: string,
    status?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "MarketplaceClientError";
    this.code = code;
    this.status = status;
  }
}

export function asRecord(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MarketplaceClientError(
      "marketplace.invalid_response",
      `技能广场返回了无效的${label}。`
    );
  }
  return value as Record<string, unknown>;
}

export function requiredString(
  record: Record<string, unknown>,
  key: string
): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

export function optionalString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function requiredNumber(
  record: Record<string, unknown>,
  key: string
): number {
  const value = record[key];
  return typeof value === "number" ? value : Number.NaN;
}

export function requiredBoolean(
  record: Record<string, unknown>,
  key: string
): boolean {
  return record[key] === true;
}

export function metadata(
  record: Record<string, unknown>
): Record<string, unknown> {
  const value = record.metadata;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeUser(raw: unknown): MarketplaceUser {
  const value = asRecord(raw, "用户信息");
  return MarketplaceUserSchema.parse({
    id: requiredString(value, "id"),
    username: requiredString(value, "username"),
    ...(optionalString(value, "email_verified_at")
      ? { emailVerifiedAt: optionalString(value, "email_verified_at") }
      : {}),
    ...(optionalString(value, "email")
      ? { email: optionalString(value, "email") }
      : {}),
    displayName:
      requiredString(value, "display_name") ||
      requiredString(value, "username"),
    avatarUrl: requiredString(value, "avatar_url"),
    bio: requiredString(value, "bio"),
    createdAt: requiredString(value, "created_at")
  });
}

export function normalizeSummary(raw: unknown): MarketplaceContentSummary {
  const value = asRecord(raw, "内容摘要");
  return MarketplaceContentSummarySchema.parse({
    contentType: requiredString(value, "content_type"),
    id: requiredString(value, "id"),
    ...(optionalString(value, "owner_user_id")
      ? { ownerUserId: optionalString(value, "owner_user_id") }
      : {}),
    title: requiredString(value, "title"),
    overview: requiredString(value, "overview"),
    ...(optionalString(value, "kind")
      ? { kind: optionalString(value, "kind") }
      : {}),
    ...(optionalString(value, "library_type")
      ? { libraryType: optionalString(value, "library_type") }
      : {}),
    ...(optionalString(value, "stage_id")
      ? { stageId: optionalString(value, "stage_id") }
      : {}),
    version: requiredNumber(value, "version"),
    coverUrl: requiredString(value, "cover_url"),
    visibility: requiredString(value, "visibility"),
    status: requiredString(value, "status"),
    enabled: requiredBoolean(value, "enabled"),
    downloadCount: requiredNumber(value, "download_count"),
    likeCount: requiredNumber(value, "like_count"),
    likedByMe: requiredBoolean(value, "liked_by_me"),
    itemCount: requiredNumber(value, "item_count"),
    ownerUsername: requiredString(value, "owner_username"),
    ownerName: requiredString(value, "owner_name"),
    ownerAvatarUrl: requiredString(value, "owner_avatar_url"),
    metadata: metadata(value),
    ...(optionalString(value, "published_at")
      ? { publishedAt: optionalString(value, "published_at") }
      : {}),
    ...(optionalString(value, "deleted_at")
      ? { deletedAt: optionalString(value, "deleted_at") }
      : {}),
    ...(optionalString(value, "purge_at")
      ? { purgeAt: optionalString(value, "purge_at") }
      : {}),
    createdAt: requiredString(value, "created_at"),
    updatedAt: requiredString(value, "updated_at")
  });
}

export function normalizeContentPage(raw: unknown): MarketplaceContentPage {
  const value = asRecord(raw, "分页列表");
  if (!Array.isArray(value.items)) {
    throw new MarketplaceClientError(
      "marketplace.invalid_response",
      "技能广场分页列表缺少有效的 items。"
    );
  }
  return MarketplaceContentPageSchema.parse({
    items: value.items.map(normalizeSummary),
    page: requiredNumber(value, "page"),
    pageSize: requiredNumber(value, "page_size"),
    total: requiredNumber(value, "total"),
    totalPages: requiredNumber(value, "total_pages")
  });
}

export function normalizeDetailBase(raw: unknown): Record<string, unknown> {
  const value = asRecord(raw, "内容详情");
  return {
    id: requiredString(value, "id"),
    ...(optionalString(value, "owner_user_id")
      ? { ownerUserId: optionalString(value, "owner_user_id") }
      : {}),
    title: requiredString(value, "title"),
    overview: requiredString(value, "overview"),
    version: requiredNumber(value, "version"),
    coverUrl: requiredString(value, "cover_url"),
    visibility: requiredString(value, "visibility"),
    status: requiredString(value, "status"),
    enabled: requiredBoolean(value, "enabled"),
    downloadCount: requiredNumber(value, "download_count"),
    metadata: metadata(value),
    ...(optionalString(value, "published_at")
      ? { publishedAt: optionalString(value, "published_at") }
      : {}),
    createdAt: requiredString(value, "created_at"),
    updatedAt: requiredString(value, "updated_at")
  };
}

export function normalizeSkillDetail(raw: unknown): MarketplaceSkillDetail {
  const value = asRecord(raw, "单技能详情");
  return MarketplaceContentDetailSchema.parse({
    ...normalizeDetailBase(value),
    contentType: "skill",
    stageId: requiredString(value, "stage_id"),
    kind: optionalString(value, "kind"),
    libraryType: requiredString(value, "library_type"),
    content: requiredString(value, "content")
  }) as MarketplaceSkillDetail;
}

export function normalizeDetail(
  contentType: MarketplaceContentRef["contentType"],
  raw: unknown
): MarketplaceContentDetail {
  if (contentType === "skill") return normalizeSkillDetail(raw);
  const value = asRecord(raw, "内容详情");
  if (contentType === "library") {
    const skills = Array.isArray(value.skills) ? value.skills : [];
    return MarketplaceContentDetailSchema.parse({
      ...normalizeDetailBase(value),
      contentType,
      kind: requiredString(value, "kind"),
      libraryType: requiredString(value, "library_type"),
      skills: skills.map(normalizeSkillDetail)
    });
  }
  const items = Array.isArray(value.items) ? value.items : [];
  return MarketplaceContentDetailSchema.parse({
    ...normalizeDetailBase(value),
    contentType,
    items: items.map(normalizeSummary)
  });
}

export function normalizeMaterialSummary(
  raw: unknown
): MarketplaceMaterialSummary {
  const value = asRecord(raw, "素材库");
  if (value.domain !== "material") {
    throw new MarketplaceClientError(
      "marketplace.invalid_response",
      "素材广场返回了其他类型的库。"
    );
  }
  return MarketplaceMaterialSummarySchema.parse({
    id: value.id,
    title: value.title,
    overview: value.overview,
    kind: value.kind,
    version: value.version
  });
}

export function normalizeMaterialDetail(
  raw: unknown
): MarketplaceMaterialDetail {
  const summary = normalizeMaterialSummary(raw);
  const value = asRecord(raw, "素材库详情");
  return MarketplaceMaterialDetailSchema.parse({
    ...summary,
    libraryType: value.library_type,
    parentGenre: value.parent_genre,
    subGenre: value.sub_genre,
    entries: Array.isArray(value.entries)
      ? value.entries.map((rawEntry) => {
          const entry = asRecord(rawEntry, "素材条目");
          return {
            stageId: entry.stage_id,
            title: entry.title,
            body: entry.body
          };
        })
      : value.entries
  });
}
