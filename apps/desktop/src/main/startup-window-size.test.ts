import { describe, expect, it } from "vitest";
import { resolveStartupWindowSize } from "./startup-window-size";

describe("startup window size", () => {
  const desktop = { width: 1920, height: 1080 };
  it("uses defaults for old settings and when the saved size is cleared", () => {
    for (const saved of [undefined, null]) {
      expect(resolveStartupWindowSize(saved, desktop)).toMatchObject({
        width: 1200,
        height: 800
      });
    }
  });
  it("restores the explicitly selected size", () => {
    expect(
      resolveStartupWindowSize({ width: 1600, height: 1000 }, desktop)
    ).toMatchObject({ width: 1600, height: 1000 });
  });
  it("fits a saved size to a smaller monitor and respects minimum sizes", () => {
    expect(
      resolveStartupWindowSize({ width: 2500, height: 1500 }, desktop)
    ).toMatchObject(desktop);
    expect(
      resolveStartupWindowSize({ width: 100, height: 100 }, desktop)
    ).toMatchObject({ width: 1120, height: 700 });
    expect(
      resolveStartupWindowSize(
        { width: 1600, height: 1000 },
        { width: 1024, height: 600 }
      )
    ).toEqual({ width: 1024, height: 600, minWidth: 1024, minHeight: 600 });
  });
});
