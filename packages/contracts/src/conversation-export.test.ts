import { describe, expect, it } from "vitest";
import {
  ConversationExportAppendSchema,
  ConversationExportBeginSchema
} from "./conversation-export";
const token = "00000000-0000-4000-8000-000000000001";
describe("conversation export contract", () => {
  it("bounds chunks by UTF-8 bytes and rejects path injection into public requests", () => {
    expect(
      ConversationExportAppendSchema.safeParse({
        token,
        seq: 0,
        text: "x".repeat(1024 * 1024)
      }).success
    ).toBe(true);
    expect(
      ConversationExportAppendSchema.safeParse({
        token,
        seq: 0,
        text: "界".repeat(350_000)
      }).success
    ).toBe(false);
    expect(
      ConversationExportBeginSchema.safeParse({
        nonce: token,
        suggestedName: "../outside.json"
      }).success
    ).toBe(false);
    expect(
      ConversationExportAppendSchema.safeParse({
        token,
        seq: 0,
        text: "x",
        filePath: "/unrequested.json"
      }).success
    ).toBe(false);
  });
});
