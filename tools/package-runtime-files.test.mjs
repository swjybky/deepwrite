import { describe, expect, it } from "vitest";
import {
  REQUIRED_RUNTIME_FILES,
  validateRuntimeFiles
} from "../apps/desktop/scripts/package-runtime-files.mjs";

describe("packaged Core storage worker inventory", () => {
  it("requires the nested worker entry in addition to the existing three utilities", () => {
    expect(() =>
      validateRuntimeFiles(
        REQUIRED_RUNTIME_FILES.filter(
          (file) => !file.includes("conversation-storage")
        ),
        () => ""
      )
    ).toThrow("conversation-storage/worker-entry.js");
  });
  it("follows relative shared chunks from the nested worker and rejects an omitted dependency", () => {
    const worker = "out/main/utilities/conversation-storage/worker-entry.js";
    const sources = new Map([
      [worker, 'import { Database } from "../../chunks/storage.js";'],
      ["out/main/chunks/storage.js", 'import "./codec.js";']
    ]);
    expect(() =>
      validateRuntimeFiles(
        REQUIRED_RUNTIME_FILES,
        (file) => sources.get(file) ?? ""
      )
    ).toThrow("out/main/chunks/storage.js");
    expect(() =>
      validateRuntimeFiles(
        [...REQUIRED_RUNTIME_FILES, "out/main/chunks/storage.js"],
        (file) => sources.get(file) ?? ""
      )
    ).toThrow("out/main/chunks/codec.js");
    expect(
      validateRuntimeFiles(
        [
          ...REQUIRED_RUNTIME_FILES,
          "out/main/chunks/storage.js",
          "out/main/chunks/codec.js"
        ],
        (file) => sources.get(file) ?? ""
      ).checkedModules
    ).toBe(8);
  });
  it("ignores documentation import examples while checking executable module edges", () => {
    expect(
      validateRuntimeFiles(
        REQUIRED_RUNTIME_FILES,
        () => "/** @param {import('./request').default} value */"
      ).checkedModules
    ).toBe(6);
  });
});
