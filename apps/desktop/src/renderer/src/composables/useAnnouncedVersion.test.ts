import { describe, expect, it } from "vitest";
import { announcedVersionStatus } from "./useAnnouncedVersion";

describe("announcement version reminders", () => {
  it("shows a reminder and manual download when the update source lags behind the announcement", () => {
    expect(announcedVersionStatus("1.5.3", "1.5.2", "1.5.0")).toEqual({
      hasVersionNotice: true,
      manualUpdateRequired: true
    });
  });

  it("uses numeric version ordering and treats stable releases as newer than prereleases", () => {
    expect(
      announcedVersionStatus("1.10.0", "1.9.0", "1.9.9").manualUpdateRequired
    ).toBe(true);
    expect(
      announcedVersionStatus("1.5.3", "1.5.3-beta.2", "1.5.3-beta.10")
        .manualUpdateRequired
    ).toBe(true);
    expect(
      announcedVersionStatus("1.5.3", "1.5.2", "1.5.4").manualUpdateRequired
    ).toBe(false);
  });

  it("recognizes 1.6.4 as newer than historical 1.6.3xx builds", () => {
    expect(announcedVersionStatus("1.6.4", "1.6.303", "1.6.4")).toEqual({
      hasVersionNotice: true,
      manualUpdateRequired: false
    });
    expect(announcedVersionStatus("1.6.4", "1.6.303", "1.6.308")).toEqual({
      hasVersionNotice: true,
      manualUpdateRequired: true
    });
  });

  it.each([
    ["1.5.3", "1.5.3"],
    ["1.5.3", "1.5.4"],
    ["1.7.9", "1.7.11"],
    ["1.7.11", "1.7.11"],
    ["1.7.11-beta.10", "1.7.11"],
    [undefined, "1.5.2"]
  ])(
    "clears all reminders for announcement %s when current version is %s",
    (announced, current) => {
      expect(announcedVersionStatus(announced, current, "1.5.0")).toEqual({
        hasVersionNotice: false,
        manualUpdateRequired: false
      });
    }
  );

  it.each([undefined, "1.7.9", "1.7.11"])(
    "shows a reminder for 1.7.11 over current 1.7.9 with update source %s",
    (remote) => {
      expect(announcedVersionStatus("1.7.11", "1.7.9", remote)).toEqual({
        hasVersionNotice: true,
        manualUpdateRequired: remote === "1.7.9"
      });
    }
  );

  it("keeps the announcement reminder when no update source version is available", () => {
    expect(announcedVersionStatus("1.5.3", "1.5.2", undefined)).toEqual({
      hasVersionNotice: true,
      manualUpdateRequired: false
    });
    expect(
      announcedVersionStatus("invalid", "1.5.2", undefined).hasVersionNotice
    ).toBe(false);
  });
});
