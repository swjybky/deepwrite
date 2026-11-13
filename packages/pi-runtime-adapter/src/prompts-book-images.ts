import type { PromptLocale } from "@deepwrite/contracts";

/** Appended after editable role prompts so custom roles keep this boundary. */
export function bookImagePreservationRule(locale?: PromptLocale): string {
  return locale === "en-US"
    ? "Lines matching ![…](images/…) are the author's illustrations. Preserve them unchanged when editing documents; do not add image references."
    : "文档中的 ![…](images/…) 是作者插图，修改时原样保留，不要新增图片引用。";
}
