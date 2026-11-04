import { describe, expect, it } from "vitest";
import { compareVersions } from "./update-version";

describe("DeepWrite release ordering", () => {
  it.each([
    ["1.7.9", "1.7.10"],
    ["1.7.9", "1.7.11"],
    ["1.7.10", "1.7.11"],
    ["1.6.9", "1.6.10"],
    ["1.9.0", "1.10.0"],
    ["2.0.0", "10.0.0"],
    ["1.7.4", "1.7.303"],
    ["2.6.4", "2.6.303"],
    ["1.6.399", "1.6.10"],
    ["1.6.399", "1.6.1000"]
  ])("orders %s before %s numerically", (older, newer) => {
    expect(compareVersions(older, newer)).toBeLessThan(0);
    expect(compareVersions(newer, older)).toBeGreaterThan(0);
  });

  it.each([
    ["1.6.3", "1.6.303"],
    ["1.6.303", "1.6.308"],
    ["1.6.303", "1.6.4"],
    ["1.6.308", "1.6.4"],
    ["1.6.399", "1.6.4"]
  ])("preserves the historical upgrade from %s to %s", (older, newer) => {
    expect(compareVersions(older, newer)).toBeLessThan(0);
    expect(compareVersions(newer, older)).toBeGreaterThan(0);
  });

  it.each([
    ["1.7.11-beta.2", "1.7.11-beta.10"],
    ["1.7.11-beta.10", "1.7.11"],
    ["1.7.11-alpha", "1.7.11-beta"],
    ["1.7.11-beta", "1.7.11-beta.1"],
    ["1.7.11-2", "1.7.11-alpha"],
    ["1.6.308", "1.6.4-beta.1"],
    ["1.6.4-beta.1", "1.6.4"]
  ])("orders prerelease %s before %s", (older, newer) => {
    expect(compareVersions(older, newer)).toBeLessThan(0);
    expect(compareVersions(newer, older)).toBeGreaterThan(0);
  });

  it("recognizes equal versions and rejects malformed versions", () => {
    expect(compareVersions("1.6.303", "1.6.303")).toBe(0);
    expect(compareVersions("1.7.11", "1.7.11")).toBe(0);
    expect(compareVersions(" 1.7.11 ", "1.7.11")).toBe(0);
    expect(compareVersions("1.7.11-beta.2", "1.7.11-beta.2")).toBe(0);
    expect(() => compareVersions("invalid", "1.7.11")).toThrow(
      "无法比较版本号"
    );
  });
});
