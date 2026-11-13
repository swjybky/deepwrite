import { describe, expect, it } from "vitest";
import { createEnvelope } from "./envelope";
import {
  TextContextMenuCommandSchema,
  TextContextMenuEventSchema
} from "./text-context-menu";

describe("text menu envelopes", () => {
  it("accepts only the supported native actions and phases", () => {
    expect(
      TextContextMenuEventSchema.safeParse(
        createEnvelope(
          "textContextMenu.event",
          { phase: "action", action: "copy" },
          { id: "menu_test" }
        )
      ).success
    ).toBe(true);
    expect(
      TextContextMenuEventSchema.safeParse(
        createEnvelope(
          "textContextMenu.event",
          { phase: "action", action: "executeJavaScript" },
          { id: "menu_test" }
        )
      ).success
    ).toBe(false);
  });

  it("does not allow document text or arbitrary capabilities in a reply", () => {
    const context = {
      kind: "editable",
      password: false,
      hasText: true,
      hasSelection: true,
      canInsertReference: true,
      canInsertImage: false
    };
    const reply = (value: unknown) =>
      createEnvelope(
        "textContextMenu.reply",
        { phase: "prepared", context: value },
        { id: "reply_test", correlationId: "menu_test" }
      );
    expect(TextContextMenuCommandSchema.safeParse(reply(context)).success).toBe(
      true
    );
    expect(
      TextContextMenuCommandSchema.safeParse(
        reply({ ...context, text: "sample manuscript" })
      ).success
    ).toBe(false);
    expect(
      TextContextMenuCommandSchema.safeParse(
        reply({ ...context, kind: "button" })
      ).success
    ).toBe(false);
  });
});
