/** Computed properties that decide where a textarea wraps and places text. */
export function textareaTypographyStyle(
  style: CSSStyleDeclaration
): Record<string, string> {
  return {
    paddingTop: style.paddingTop,
    paddingRight: style.paddingRight,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    textIndent: style.textIndent,
    textTransform: style.textTransform,
    tabSize: style.tabSize,
    whiteSpace: style.whiteSpace,
    wordBreak: style.wordBreak,
    overflowWrap: style.overflowWrap
  };
}

function resolveLineHeight(style: CSSStyleDeclaration): number {
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;
  const fontSize = Number.parseFloat(style.fontSize) * 1.95;
  return Number.isFinite(fontSize) ? fontSize : 0;
}

/**
 * Top of the line that holds `offset`, in the textarea's scroll coordinates.
 * Soft-wrapped lines count, so long paragraphs measure where they render.
 */
export function measureTextareaOffsetTop(
  textarea: HTMLTextAreaElement,
  offset: number,
  style = globalThis.getComputedStyle(textarea)
): number {
  const ownerDocument = textarea.ownerDocument;
  const mirror = ownerDocument.createElement("div");
  Object.assign(mirror.style, textareaTypographyStyle(style), {
    position: "absolute",
    top: "0",
    left: "0",
    boxSizing: "border-box",
    width: `${textarea.clientWidth}px`,
    overflow: "hidden",
    visibility: "hidden",
    pointerEvents: "none"
  });
  mirror.textContent = textarea.value.slice(0, offset);
  const marker = ownerDocument.createElement("span");
  marker.textContent = "​";
  mirror.append(marker);
  ownerDocument.body.append(mirror);
  try {
    return marker.offsetTop;
  } finally {
    mirror.remove();
  }
}

/**
 * Scrolls `offset` into view unless it is already visible below `topInset`,
 * the height covered by a floating panel at the top of the textarea.
 */
export function revealTextareaOffset(
  textarea: HTMLTextAreaElement,
  offset: number,
  topInset = 0
): void {
  const style = globalThis.getComputedStyle(textarea);
  const top = measureTextareaOffsetTop(textarea, offset, style);
  const height = textarea.clientHeight;
  const inset = Math.min(Math.max(0, topInset), height / 2);
  const visibleTop = textarea.scrollTop + inset;
  const visibleBottom = textarea.scrollTop + height;
  if (top >= visibleTop && top + resolveLineHeight(style) <= visibleBottom) {
    return;
  }
  textarea.scrollTop = Math.max(0, top - inset - (height - inset) / 3);
}
