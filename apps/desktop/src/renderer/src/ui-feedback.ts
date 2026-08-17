import { readonly, shallowRef } from "vue";

export type UiMessageKind = "success" | "error" | "warning" | "info";

export interface UiMessageItem {
  id: number;
  kind: UiMessageKind;
  content: string;
}

export interface UiMessageOptions {
  duration?: number;
}

const DEFAULT_DURATION_MS = 3_200;
const MAX_VISIBLE_MESSAGES = 3;
const items = shallowRef<UiMessageItem[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let messageId = 0;

function remove(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  if (items.value.some((item) => item.id === id)) {
    items.value = items.value.filter((item) => item.id !== id);
  }
}

function formatErrorMessage(content: string): string {
  if (!content.startsWith("[") || !content.endsWith("]")) return content;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
      const issue = parsed[0];
      if ("code" in issue && "path" in issue) {
        const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
        if (issue.code === "too_small" && path === "title") {
          return "标题不能为空，请输入有效标题。";
        }
        if (issue.code === "too_small") {
          return `${path ? `“${path}”` : "输入"}内容长度不足。`;
        }
        if (issue.code === "too_big") {
          return `${path ? `“${path}”` : "输入"}内容超出最大限制。`;
        }
        return `输入内容无效（${path || issue.code}）。`;
      }
    }
  } catch {
    // Ignore JSON parse errors and return original content
  }
  return content;
}

function show(
  kind: UiMessageKind,
  content: string,
  options: UiMessageOptions = {}
): number {
  const normalized = formatErrorMessage(String(content).trim());
  if (!normalized) return -1;
  const id = ++messageId;
  const overflow = Math.max(
    0,
    items.value.length + 1 - MAX_VISIBLE_MESSAGES
  );
  items.value.slice(0, overflow).forEach((item) => remove(item.id));
  items.value = [...items.value, { id, kind, content: normalized }];
  const duration = Math.max(0, options.duration ?? DEFAULT_DURATION_MS);
  if (duration > 0) {
    timers.set(id, setTimeout(() => remove(id), duration));
  }
  return id;
}

export const uiMessageItems = readonly(items);
export const dismissUiMessage = remove;
export const uiMessage = {
  success: (content: string, options?: UiMessageOptions) =>
    show("success", content, options),
  error: (content: string, options?: UiMessageOptions) =>
    show("error", content, options),
  warning: (content: string, options?: UiMessageOptions) =>
    show("warning", content, options),
  info: (content: string, options?: UiMessageOptions) =>
    show("info", content, options)
};
