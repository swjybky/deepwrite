import { parseMaterialMarkdown } from "./material-markdown";
import {
  writeMarkdownMetadataFields,
  type MarkdownMetadataEditResult
} from "./markdown-metadata-edit";

export type MaterialMetadataEditResult = MarkdownMetadataEditResult;

/** Updates only an editor draft. Callers retain their normal save/conflict path. */
export function updateMaterialMarkdownMetadata(
  content: string,
  values: { name: string; description: string }
): MaterialMetadataEditResult {
  const parsed = parseMaterialMarkdown(content);
  if (parsed.state === "malformed") {
    return {
      updated: false,
      message:
        "已有说明头部无法安全修改，请在正文编辑器中调整；素材仍可正常使用。"
    };
  }
  return {
    updated: true,
    content: writeMarkdownMetadataFields(content, parsed.headerEnd, {
      name: JSON.stringify(values.name.replace(/\s+/g, " ").trim()),
      description: JSON.stringify(
        values.description.replace(/\s+/g, " ").trim()
      )
    })
  };
}
