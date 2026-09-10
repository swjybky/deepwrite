import { describe, expect, it } from "vitest";
import { createEnvelope } from "./envelope";
import {
  RENDERER_STATE_KEY_MAX_LENGTH,
  RendererStateHistoryKeysResultSchema,
  RendererStateKeySchema,
  RendererStateLoadResultSchema,
  RendererStateSaveCommandEnvelopeSchema
} from "./renderer-state";
import { CommandEnvelopeSchema } from "./system";

describe("renderer state contracts", () => {
  it("validates atomic history migration and rejects duplicate or non-history sources", () => {
    const payload = {
      key: "conversation-history:book-chat",
      value: { version: 1 },
      expected: { found: false },
      sources: [
        { key: "conversation-history:book-plot", value: { version: 1 } }
      ]
    };
    const command = (value: unknown) =>
      createEnvelope("rendererState.migrateHistory", value, {
        id: "test-migration"
      });
    expect(CommandEnvelopeSchema.safeParse(command(payload)).success).toBe(
      true
    );
    for (const sourceKey of [
      payload.key,
      "conversation-preferences:run-options:v1"
    ]) {
      expect(
        CommandEnvelopeSchema.safeParse(
          command({ ...payload, sources: [{ key: sourceKey, value: {} }] })
        ).success
      ).toBe(false);
    }
    expect(
      CommandEnvelopeSchema.safeParse(
        command({
          ...payload,
          sources: [{ key: "conversation-history:book-plot" }]
        })
      ).success
    ).toBe(false);
    const { value: _value, ...missingValue } = payload;
    expect(CommandEnvelopeSchema.safeParse(command(missingValue)).success).toBe(
      false
    );
  });

  it("validates the history-key discovery command and its returned keys", () => {
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope(
          "rendererState.listHistoryKeys",
          {},
          { id: "list-history", correlationId: "list-history" }
        )
      ).success
    ).toBe(true);
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope(
          "rendererState.listHistoryKeys",
          { path: "/example.test/private" },
          { id: "list-history", correlationId: "list-history" }
        )
      ).success
    ).toBe(false);
    expect(
      RendererStateHistoryKeysResultSchema.parse([
        "conversation-history:book%3Aone"
      ])
    ).toEqual(["conversation-history:book%3Aone"]);
    expect(
      RendererStateHistoryKeysResultSchema.safeParse([
        "unrelated-state:example"
      ]).success
    ).toBe(false);
  });

  it("accepts only bounded conversation persistence keys", () => {
    expect(
      RendererStateKeySchema.parse("conversation-history:book%3Aone")
    ).toBe("conversation-history:book%3Aone");
    expect(
      RendererStateKeySchema.parse(
        "conversation-preferences:model-selection:v1"
      )
    ).toBe("conversation-preferences:model-selection:v1");

    const prefix = "conversation-history:";
    expect(
      RendererStateKeySchema.safeParse(
        `${prefix}${"a".repeat(RENDERER_STATE_KEY_MAX_LENGTH - prefix.length)}`
      ).success
    ).toBe(true);
    expect(
      RendererStateKeySchema.safeParse(
        `${prefix}${"a".repeat(RENDERER_STATE_KEY_MAX_LENGTH - prefix.length + 1)}`
      ).success
    ).toBe(false);
  });

  it("rejects unscoped, empty, traversal-like and malformed encoded keys", () => {
    for (const key of [
      "history:book-one",
      "conversation-history:",
      "conversation-history:../book-one",
      "conversation-history:book one",
      "conversation-history:中文",
      "conversation-history:book%ZZone"
    ]) {
      expect(RendererStateKeySchema.safeParse(key).success, key).toBe(false);
    }
  });

  it("registers load, save and remove envelopes in the shared command union", () => {
    const commands = [
      createEnvelope(
        "rendererState.load",
        { key: "conversation-history:book-one" },
        { id: "renderer-state-load" }
      ),
      createEnvelope(
        "rendererState.save",
        {
          key: "conversation-history:book-one",
          value: { version: 1, messages: ["placeholder"] }
        },
        { id: "renderer-state-save" }
      ),
      createEnvelope(
        "rendererState.remove",
        { key: "conversation-history:book-one" },
        { id: "renderer-state-remove" }
      )
    ];

    expect(
      commands.map((command) => CommandEnvelopeSchema.parse(command).type)
    ).toEqual([
      "rendererState.load",
      "rendererState.save",
      "rendererState.remove"
    ]);
    expect(
      RendererStateSaveCommandEnvelopeSchema.safeParse(
        createEnvelope(
          "rendererState.save",
          { key: "conversation-history:book-one" },
          { id: "renderer-state-save-missing-value" }
        )
      ).success
    ).toBe(false);
  });

  it("distinguishes missing values from persisted null", () => {
    expect(RendererStateLoadResultSchema.parse({ found: false })).toEqual({
      found: false
    });
    expect(
      RendererStateLoadResultSchema.parse({ found: true, value: null })
    ).toEqual({
      found: true,
      value: null
    });
    expect(
      RendererStateLoadResultSchema.safeParse({ found: true }).success
    ).toBe(false);
  });
});
