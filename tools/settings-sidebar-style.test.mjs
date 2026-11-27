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
});
