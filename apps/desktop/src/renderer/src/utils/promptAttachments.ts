import {
  PROMPT_IMAGE_ATTACHMENT_MAX_BYTES,
  PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH,
  PromptImageAttachmentSchema,
  PromptTextAttachmentSchema,
  type PromptImageMediaType,
  type UserPromptAttachment
} from "@deepwrite/contracts";

export const PROMPT_ATTACHMENT_ACCEPT = [
  ".txt",
  ".md",
  ".markdown",
  ".pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
].join(",");

const TEXT_FILE_MAX_BYTES = 5 * 1024 * 1024;
const PDF_FILE_MAX_BYTES = 20 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown"]);
const IMAGE_MEDIA_TYPES = new Set<PromptImageMediaType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

export interface PromptAttachmentReadResult {
  attachment: UserPromptAttachment;
  warning?: string;
}

function extensionOf(name: string): string {
  return name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
}

function attachmentId(): string {
  return `prompt_attachment_${globalThis.crypto.randomUUID()}`;
}

function imageMediaType(file: File): PromptImageMediaType | undefined {
  if (IMAGE_MEDIA_TYPES.has(file.type as PromptImageMediaType)) {
    return file.type as PromptImageMediaType;
  }
  const extension = extensionOf(file.name);
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return undefined;
}

function textMediaType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }
  return extensionOf(file.name) === "txt" ? "text/plain" : "text/markdown";
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8_192)));
  }
  return globalThis.btoa(chunks.join(""));
}

async function readImage(file: File, mediaType: PromptImageMediaType): Promise<PromptAttachmentReadResult> {
  if (file.size > PROMPT_IMAGE_ATTACHMENT_MAX_BYTES) {
    throw new Error(`图片“${file.name}”超过 10 MB，无法作为模型图片输入。`);
  }
  const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  return {
    attachment: PromptImageAttachmentSchema.parse({
      id: attachmentId(),
      kind: "image",
      name: file.name,
      mediaType,
      size: file.size,
      data
    })
  };
}

function extractedTextAttachment(
  file: File,
  mediaType: string,
  extractedContent: string
): PromptAttachmentReadResult {
  const normalized = extractedContent.replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    throw new Error(
      mediaType === "application/pdf"
        ? `PDF“${file.name}”没有可提取的文本；扫描版 PDF 请先完成 OCR。`
        : `文件“${file.name}”没有可读取的文本内容。`
    );
  }
  const content = normalized.slice(0, PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH);
  const truncated = content.length < normalized.length;
  return {
    attachment: PromptTextAttachmentSchema.parse({
      id: attachmentId(),
      kind: "text",
      name: file.name,
      mediaType,
      size: file.size,
      content,
      ...(truncated ? { truncated: true, originalLength: normalized.length } : {})
    }),
    ...(truncated
      ? {
          warning: `“${file.name}”文本较长，仅携带前 ${PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH.toLocaleString("zh-CN")} 个字符。`
        }
      : {})
  };
}

async function readPlainText(file: File): Promise<PromptAttachmentReadResult> {
  if (file.size > TEXT_FILE_MAX_BYTES) {
    throw new Error(`文本文件“${file.name}”超过 5 MB，请缩小后再上传。`);
  }
  return extractedTextAttachment(file, textMediaType(file), await file.text());
}

async function readPdfText(file: File): Promise<PromptAttachmentReadResult> {
  if (file.size > PDF_FILE_MAX_BYTES) {
    throw new Error(`PDF“${file.name}”超过 20 MB，请拆分或压缩后再上传。`);
  }
  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ]);
  GlobalWorkerOptions.workerSrc = workerModule.default;
  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true
  });
  try {
    const document = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      let pageText = "";
      for (const item of textContent.items) {
        if (!("str" in item)) continue;
        pageText += item.str;
        pageText += item.hasEOL ? "\n" : " ";
      }
      if (pageText.trim()) {
        pages.push(pageText.trim());
      }
      page.cleanup();
    }
    return extractedTextAttachment(file, "application/pdf", pages.join("\n\n"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "未知 PDF 解析错误";
    if (/password/i.test(message)) {
      throw new Error(`PDF“${file.name}”受密码保护，暂时无法读取。`);
    }
    throw new Error(`读取 PDF“${file.name}”失败：${message}`);
  } finally {
    await loadingTask.destroy();
  }
}

export async function readPromptAttachment(file: File): Promise<PromptAttachmentReadResult> {
  const mediaType = imageMediaType(file);
  if (mediaType) {
    return readImage(file, mediaType);
  }
  const extension = extensionOf(file.name);
  if (extension === "pdf" || file.type === "application/pdf") {
    return readPdfText(file);
  }
  if (TEXT_EXTENSIONS.has(extension) || file.type.startsWith("text/")) {
    return readPlainText(file);
  }
  throw new Error(`不支持“${file.name}”的文件类型；请选择 TXT、MD、PDF 或常见图片。`);
}
