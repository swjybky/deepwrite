import { describe, expect, it } from "vitest";
import source from "./FreeModelsPanel.vue?raw";
import { freeModelStatus, isFreeModelAvailable } from "./freeModelPresentation";

describe("FreeModelsPanel", () => {
  it("treats a keyless free endpoint as available when its status is not disabled", () => {
    expect(isFreeModelAvailable({ status: undefined })).toBe(true);
    expect(freeModelStatus({ status: undefined })).toBe("可用");
    expect(isFreeModelAvailable({ status: 0 })).toBe(true);
  });

  it("disables models explicitly marked unavailable", () => {
    expect(isFreeModelAvailable({ status: 1 })).toBe(false);
    expect(freeModelStatus({ status: 1 })).toBe("暂不可用");
    expect(source).toContain("!isFreeModelAvailable(model)");
  });
});
