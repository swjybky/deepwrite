import { describe, expect, it } from "vitest";
import { freeModelStatus, isFreeModelAvailable } from "./freeModelPresentation";

describe("FreeModelsPanel", () => {
  it("treats a keyless free endpoint as available when its status is not disabled", () => {
    expect(isFreeModelAvailable({ status: undefined })).toBe(true);
    expect(freeModelStatus({ status: undefined })).toBe("可用");
    expect(isFreeModelAvailable({ status: 0 })).toBe(true);
  });
});
