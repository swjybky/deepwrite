import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settingsPageCss = readFileSync(
  new URL(
    "../apps/desktop/src/renderer/src/components/settings-page.css",
    import.meta.url
  ),
  "utf8"
);

describe("scoped settings sidebar CSS", () => {
  it("keeps complete descendant selectors inside :global()", () => {
    expect(settingsPageCss).not.toMatch(
      /:global\((?:[^()]|\([^)]*\))+\)\s+(?:\.|:)/
    );
  });

  it("keeps macOS settings sidebar controls out of the window drag region", () => {
    expect(settingsPageCss).toMatch(
      /:global\(\s*html\[data-platform="darwin"\]\s+\.settings-sidebar\s+:is\(button,\s*input,\s*a,\s*\.settings-search,\s*\.settings-nav\)\s*\)\s*\{\s*-webkit-app-region:\s*no-drag;/
    );
  });
});
