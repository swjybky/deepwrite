import type { UserMessage } from "@earendil-works/pi-ai";
import type { AgentRunInput } from "./runtime-types";

type RawUserTurn = Pick<
  AgentRunInput,
  "prompt" | "attachments" | "promptLocale"
>;

/** Raw user turn: the prompt plus any uploaded attachments, without context. */
export function buildRawUserText(input: RawUserTurn): string {
  const attachments = input.attachments ?? [];
  const textAttachments = attachments.filter(
    (attachment) => attachment.kind === "text"
  );
  const imageAttachments = attachments.filter(
    (attachment) => attachment.kind === "image"
  );
  const lines = [input.prompt];
  if (textAttachments.length) {
    lines.push(
      "",
      input.promptLocale === "en-US"
        ? "[Uploaded text attachments]"
        : "【用户上传的文本附件】"
    );
    for (const attachment of textAttachments) {
      lines.push(
        "",
        `--- ${attachment.name} (${attachment.mediaType}) ---`,
        attachment.content,
        attachment.truncated
          ? input.promptLocale === "en-US"
            ? `[DeepWrite: attachment truncated${attachment.originalLength === undefined ? "" : ` from ${attachment.originalLength} characters`}.]`
            : `[DeepWrite：附件文本已截断；原文 ${attachment.originalLength?.toLocaleString("zh-CN") ?? "超过限制"} 个字符。]`
          : ""
      );
    }
  }
  if (imageAttachments.length) {
    lines.push(
      "",
      input.promptLocale === "en-US"
        ? `[Uploaded images] ${imageAttachments.map((item) => item.name).join(", ")}`
        : `【用户上传的图片】${imageAttachments.map((attachment) => attachment.name).join("、")}`
    );
  }
  return lines.filter((line) => line !== "").join("\n");
}

export function imageContentBlocks(input: RawUserTurn): Array<{
  type: "image";
  data: string;
  mimeType: string;
}> {
  return (input.attachments ?? []).flatMap((attachment) =>
    attachment.kind === "image"
      ? [
          {
            type: "image" as const,
            data: attachment.data,
            mimeType: attachment.mediaType
          }
        ]
      : []
  );
}

/** User message content for a raw turn: text, plus image blocks if any. */
export function rawUserMessageContent(
  input: RawUserTurn
): UserMessage["content"] {
  const text = buildRawUserText(input);
  const images = imageContentBlocks(input);
  return images.length ? [{ type: "text", text }, ...images] : text;
}

/** A message the user added while the run was working, injected mid-run. */
export function buildSteeringUserText(input: RawUserTurn): string {
  return [
    "【运行中用户补充】",
    "用户在你工作过程中追加了下面的要求。已经执行的工具调用不会撤销；请据此调整接下来的步骤，与先前要求冲突时以这条为准。",
    "",
    buildRawUserText(input)
  ].join("\n");
}
