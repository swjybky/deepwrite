import {
  PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH,
  PromptTextAttachmentSchema,
  type UserPromptAttachment
} from "@deepwrite/contracts";
import type { EditorTextReference } from "../types/conversation";
import type { WorkspaceDocument } from "../types/workspace";

export interface EditorTextSelectionInput {
  id: string;
  resourceId: string;
  document: WorkspaceDocument;
  start: number;
  end: number;
}

export interface EditorTextRange {
  start: number;
  end: number;
}

function lineNumberAt(content: string, offset: number): number {
  let line = 1;
  const boundedOffset = Math.max(0, Math.min(content.length, offset));
  for (let index = 0; index < boundedOffset; index += 1) {
    if (content[index] === "\n") line += 1;
  }
  return line;
}

export function createEditorTextReference(
  input: EditorTextSelectionInput
): EditorTextReference | undefined {
  const start = Math.max(0, Math.min(input.document.content.length, input.start));
  const end = Math.max(start, Math.min(input.document.content.length, input.end));
  const text = input.document.content.slice(start, end);
  if (!text.trim()) return undefined;

  const startLine = lineNumberAt(input.document.content, start);
  const endLine = lineNumberAt(input.document.content, Math.max(start, end - 1));
  return {
    id: input.id,
    resourceId: input.resourceId,
    documentId: input.document.id,
    documentTitle: input.document.title,
    documentPath: [...input.document.path],
    text,
    start,
    end,
    startLine,
    endLine,
    label: `${input.document.title} (${startLine}-${endLine})`
  };
}

export function resolveEditorTextReferenceRange(
  content: string,
  reference: EditorTextReference
): EditorTextRange {
  const expectedStart = Math.max(0, Math.min(content.length, reference.start));
  const expectedEnd = Math.max(expectedStart, Math.min(content.length, reference.end));
  if (content.slice(expectedStart, expectedEnd) === reference.text) {
    return { start: expectedStart, end: expectedEnd };
  }

  let closestStart = -1;
  let candidate = content.indexOf(reference.text);
  while (candidate !== -1) {
    if (
      closestStart === -1 ||
      Math.abs(candidate - expectedStart) < Math.abs(closestStart - expectedStart)
    ) {
      closestStart = candidate;
    }
    candidate = content.indexOf(reference.text, candidate + 1);
  }
  if (closestStart !== -1) {
    return { start: closestStart, end: closestStart + reference.text.length };
  }
  return { start: expectedStart, end: expectedEnd };
}

export function createEditorReferenceAttachment(
  reference: EditorTextReference
): UserPromptAttachment {
  const content = reference.text.slice(0, PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH);
  const truncated = content.length < reference.text.length;
  return PromptTextAttachmentSchema.parse({
    id: `editor_reference_${reference.id}`.slice(0, 120),
    kind: "text",
    name: reference.label.slice(0, 240),
    mediaType: "text/plain; source=editor-selection",
    size: new TextEncoder().encode(content).byteLength,
    content,
    ...(truncated ? { truncated: true, originalLength: reference.text.length } : {})
  });
}
