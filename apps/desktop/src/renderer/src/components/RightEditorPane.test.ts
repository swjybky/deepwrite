import { describe, expect, it } from "vitest";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import editorStyles from "virtual:deepwrite-renderer-styles";

describe("RightEditorPane expert draft navigation", () => {
  it("loads the consolidated editor layout without stale header rows", () => {
    expect(editorStyles.match(/\.editor-pane\s*\{/g)).toHaveLength(1);
    expect(editorStyles).toContain(
      "grid-template-rows: minmax(40px, auto) minmax(0, 1fr) minmax(36px, auto);"
    );
    expect(editorStyles).toContain("minmax(42px, auto) minmax(40px, auto)");
    expect(editorStyles).not.toContain(
      'html[data-platform="darwin"] .editor-pane'
    );
  });
});
