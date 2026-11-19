import { describe, expect, it } from "vitest";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import rendererStyles from "virtual:deepwrite-renderer-styles";

describe("ConversationTurnNavigator", () => {
  it("keeps the navigator on the right without a pill background", () => {
    const navigatorStart = rendererStyles.indexOf(
      ".conversation-turn-navigator {"
    );
    const navigatorEnd = rendererStyles.indexOf("}", navigatorStart);
    const navigatorStyles = rendererStyles.slice(navigatorStart, navigatorEnd);
    const listStart = rendererStyles.indexOf(
      ".conversation-turn-marker-list {"
    );
    const listEnd = rendererStyles.indexOf("}", listStart);
    const listStyles = rendererStyles.slice(listStart, listEnd);
    const markerStart = rendererStyles.indexOf(".conversation-turn-marker {");
    const markerEnd = rendererStyles.indexOf("}", markerStart);
    const markerStyles = rendererStyles.slice(markerStart, markerEnd);
    const lineStart = rendererStyles.indexOf(
      ".conversation-turn-marker-line {"
    );
    const lineEnd = rendererStyles.indexOf("}", lineStart);
    const lineStyles = rendererStyles.slice(lineStart, lineEnd);
    const activeLineStart = rendererStyles.indexOf(
      ".conversation-turn-marker.is-active .conversation-turn-marker-line {"
    );
    const activeLineEnd = rendererStyles.indexOf("}", activeLineStart);
    const activeLineStyles = rendererStyles.slice(
      activeLineStart,
      activeLineEnd
    );
    const previewStart = rendererStyles.indexOf(".conversation-turn-preview {");
    const previewEnd = rendererStyles.indexOf("}", previewStart);
    const previewStyles = rendererStyles.slice(previewStart, previewEnd);

    expect(navigatorStyles).toContain("right: -4px;");
    expect(navigatorStyles).not.toContain("left:");
    expect(navigatorStyles).toContain("--conversation-turn-max-visible");
    expect(navigatorStyles).toContain("calc(100% - 32px)");
    expect(navigatorStyles).toContain("pointer-events: none;");
    expect(listStyles).toContain("width: 44px;");
    expect(listStyles).toContain("min-height: 0;");
    expect(listStyles).toContain("margin: 0 0 0 auto;");
    expect(listStyles).toContain("overflow-y: auto;");
    expect(listStyles).toContain("overscroll-behavior: contain;");
    expect(listStyles).toContain("pointer-events: auto;");
    expect(markerStyles).toContain("background: transparent;");
    expect(lineStyles).toContain("width: 8px;");
    expect(lineStyles).toContain("height: 3px;");
    expect(activeLineStyles).not.toContain("width:");
    expect(activeLineStyles).toContain("background: var(--text-secondary);");
    expect(rendererStyles).toContain(
      ".conversation-turn-marker:hover .conversation-turn-marker-line"
    );
    expect(rendererStyles).not.toContain(
      ".conversation-turn-navigator:hover .conversation-turn-marker-line"
    );
    expect(rendererStyles).toContain("width: 26px;");
    expect(previewStyles).toContain("right: 40px;");
    expect(previewStyles).toContain("transform-origin: right center;");
    expect(rendererStyles).toContain(".conversation-turn-preview.is-visible");
  });
});
