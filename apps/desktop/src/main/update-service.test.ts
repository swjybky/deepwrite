import { describe, expect, it } from "vitest";
import { compareVersions } from "./update-version";

describe("compareVersions", () => {
  it("compares stable versions numerically with legacy build compatibility", () => {
    expect(compareVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.1.9", "1.2.0")).toBeLessThan(0);
    expect(compareVersions("1.6.4", "1.6.303")).toBeGreaterThan(0);
    expect(compareVersions("1.6.9", "1.6.10")).toBeLessThan(0);
  });

  it("compares prerelease suffixes numerically before stable releases", () => {
    expect(compareVersions("1.2.0-beta.2", "1.2.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0-beta.2", "1.2.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBeLessThan(0);
  });
});
