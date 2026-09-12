import { afterEach, describe, expect, it } from "vitest";
import { openConversationDatabase, Statements } from "./schema";
import { JsonNodes } from "./json-nodes";
import { JsonStreamParser, type JsonParserState } from "./json-stream-parser";

const databases: ReturnType<typeof openConversationDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));
function create() {
  const database = openConversationDatabase(":memory:");
  databases.push(database);
  const nodes = new JsonNodes(new Statements(database));
  return { nodes, parser: new JsonStreamParser(nodes) };
}

describe("resumable JSON stream parser", () => {
  it("preserves JSON key ordering, escaped Unicode, long strings, unknown fields and surrogate code units", () => {
    const { nodes } = create();
    let parser = new JsonStreamParser(nodes);
    const source =
      '{"messages":[{"content":' +
      JSON.stringify('文😀\\\n"'.repeat(30_000) + "\ud800") +
      '}],"sessionId":"after-messages","__proto__":{"data":true},"nested":[0,-1,1e3,null,[],{}],"escapes":"\\uD83D\\uDE00"}';
    for (let offset = 0; offset < source.length; offset += 997) {
      parser.feed(source.slice(offset, offset + 997));
      const checkpoint = JSON.stringify(parser.state);
      expect(checkpoint.length).toBeLessThan(512 * 1024);
      parser = new JsonStreamParser(
        nodes,
        JSON.parse(checkpoint) as JsonParserState
      );
    }
    expect(nodes.read(parser.finish())).toEqual(JSON.parse(source));
  });

  it.each([
    '{"a":1,}',
    "[1,]",
    '{"a":}',
    '{"a":1 "b":2}',
    "{} false",
    '{"a":1,"a":2}',
    "[NaN]",
    "[1e999]",
    "[01]",
    "[\u00a0]",
    '"\\x"',
    '"bad\ntext"',
    '{"unfinished":'
  ])(
    "rejects invalid or ambiguous input without reporting a completed document: %s",
    (source) => {
      const { parser } = create();
      expect(() => {
        for (const char of source) parser.feed(char);
        parser.finish();
      }).toThrow();
    }
  );
});
