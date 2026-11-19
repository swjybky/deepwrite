import { describe, expect, it } from "vitest";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import rendererStyles from "virtual:deepwrite-renderer-styles";
import indicatorSource from "./ContextWindowIndicator.vue?raw";

describe("ContextWindowIndicator", () => {
  it("teleports a keyboard-accessible tooltip outside the clipped composer", () => {
    expect(indicatorSource).toContain('<Teleport to="body">');
    expect(indicatorSource).toContain('role="tooltip"');
    expect(indicatorSource).toContain('@focus="focused = true"');
    expect(indicatorSource).toContain('@keydown.esc.prevent="closeTooltip"');
    expect(indicatorSource).toContain("getBoundingClientRect()");
    expect(indicatorSource).toContain("window.innerWidth");
    expect(rendererStyles).toContain("position: fixed;");
  });

  it("uses theme variables and preserves the compact toolbar footprint", () => {
    expect(rendererStyles).toContain("var(--surface-raised");
    expect(rendererStyles).toContain("var(--theme-line");
    expect(rendererStyles).toContain("var(--text-primary");
    expect(rendererStyles).toContain("var(--accent");
    expect(rendererStyles).toContain("flex: 0 0 auto;");
    expect(rendererStyles).toContain("width: 14px;");
    expect(rendererStyles).toContain("fill: none;");
    expect(rendererStyles).not.toContain("stroke-dasharray: 2 3;");
    expect(rendererStyles).toContain("prefers-reduced-motion: reduce");
  });
});
