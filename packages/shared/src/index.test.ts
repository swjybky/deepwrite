import { describe, expect, it } from "vitest";
import { createCatalogId, createId, randomHex8 } from "./index";

describe("short random ids", () => {
  it("randomHex8 returns eight lowercase hex characters", () => {
    expect(randomHex8()).toMatch(/^[0-9a-f]{8}$/);
  });

  it("createId uses underscore and an eight-character suffix", () => {
    expect(createId("evt")).toMatch(/^evt_[0-9a-f]{8}$/);
  });

  it("createCatalogId uses hyphen and an eight-character suffix", () => {
    expect(createCatalogId("book")).toMatch(/^book-[0-9a-f]{8}$/);
  });
});
