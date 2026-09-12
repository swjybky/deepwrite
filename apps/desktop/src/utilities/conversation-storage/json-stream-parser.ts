import type { JsonNodes, ValueRef } from "./json-nodes";

type Frame = {
  kind: "array" | "object";
  ref: ValueRef;
  count: number;
  state: "key" | "colon" | "value" | "comma";
  key?: string;
  afterComma?: boolean;
};
type Token = {
  kind: "string" | "number" | "literal";
  buffer: string;
  key: boolean;
  escaped?: boolean;
  unicode?: string;
  ref?: ValueRef;
};
export type JsonParserState = {
  frames: Frame[];
  token?: Token;
  root?: ValueRef;
};

/** Streaming, resumable JSON parser. Large strings live in chunk rows, never in its checkpoint. */
export class JsonStreamParser {
  readonly state: JsonParserState;
  constructor(
    private readonly nodes: JsonNodes,
    state?: JsonParserState
  ) {
    this.state = state ?? { frames: [] };
  }

  private accept(ref: ValueRef): void {
    const frame = this.state.frames.at(-1);
    if (!frame) {
      if (this.state.root)
        throw new Error("History contains multiple JSON documents.");
      this.state.root = ref;
      return;
    }
    const key = frame.kind === "array" ? frame.count : frame.key;
    if (key === undefined) throw new Error("History object key is missing.");
    if (frame.kind === "object" && this.nodes.get(frame.ref, [key]))
      throw new Error(
        "History contains a duplicate object key; original data has been preserved."
      );
    frame.ref = this.nodes.patch(
      frame.ref,
      { op: "set", path: [key], value: null },
      0,
      ref
    );
    frame.count++;
    frame.state = "comma";
    delete frame.afterComma;
    delete frame.key;
  }

  private flushText(token: Token): void {
    if (token.key || !token.buffer) return;
    token.ref = token.ref
      ? this.nodes.appendText(token.ref, token.buffer)
      : this.nodes.create(token.buffer);
    token.buffer = "";
  }

  private string(char: string, token: Token): void {
    if (token.unicode !== undefined) {
      if (!/^[\da-f]$/i.test(char))
        throw new Error("History contains an invalid Unicode escape.");
      token.unicode += char;
      if (token.unicode.length === 4) {
        token.buffer += String.fromCharCode(parseInt(token.unicode, 16));
        delete token.unicode;
      }
    } else if (token.escaped) {
      delete token.escaped;
      if (char === "u") token.unicode = "";
      else {
        const escapes: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t"
        };
        const value = escapes[char];
        if (value === undefined)
          throw new Error("History contains an invalid string escape.");
        token.buffer += value;
      }
    } else if (char === "\\") token.escaped = true;
    else if (char === '"') {
      delete this.state.token;
      if (token.key) {
        const frame = this.state.frames.at(-1)!;
        frame.key = token.buffer;
        frame.state = "colon";
      } else {
        this.flushText(token);
        this.accept(token.ref ?? this.nodes.create(""));
      }
      return;
    } else {
      if (char.charCodeAt(0) < 32)
        throw new Error("History contains an unescaped control character.");
      token.buffer += char;
    }
    if (token.key && token.buffer.length > 1024 * 1024)
      throw new Error(
        "History contains an oversized property name; original data has been preserved."
      );
    if (!token.key && token.buffer.length >= 64 * 1024) this.flushText(token);
  }

  private primitive(token: Token): void {
    const value: unknown = JSON.parse(token.buffer);
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("History contains a non-finite number.");
    if (
      value !== null &&
      typeof value !== "boolean" &&
      typeof value !== "number"
    )
      throw new Error("History primitive is invalid.");
    delete this.state.token;
    this.accept(this.nodes.create(value));
  }

  feed(text: string): void {
    for (let index = 0; index < text.length; index++) {
      const char = text[index]!;
      const token = this.state.token;
      if (token) {
        if (token.kind === "string") {
          this.string(char, token);
          continue;
        }
        if (/^[ \t\r\n,}\]]$/.test(char)) {
          this.primitive(token);
          index--;
          continue;
        }
        token.buffer += char;
        if (token.buffer.length > 1024)
          throw new Error("History contains an oversized primitive token.");
        continue;
      }
      if (/^[ \t\r\n]$/.test(char)) continue;
      const frame = this.state.frames.at(-1);
      if (frame?.state === "colon") {
        if (char !== ":") throw new Error("History object is missing a colon.");
        frame.state = "value";
        continue;
      }
      if (frame?.state === "comma") {
        if (char === ",") {
          frame.state = frame.kind === "array" ? "value" : "key";
          frame.afterComma = true;
          continue;
        }
        if (char !== (frame.kind === "array" ? "]" : "}"))
          throw new Error("History container is missing a comma.");
      }
      if (frame && char === (frame.kind === "array" ? "]" : "}")) {
        if (
          frame.afterComma ||
          (frame.state !== "comma" &&
            (frame.count > 0 ||
              (frame.state === "value" && frame.kind === "object")))
        )
          throw new Error("History container ends before its value.");
        this.state.frames.pop();
        this.accept(frame.ref);
        continue;
      }
      if (frame?.state === "key") {
        if (char !== '"')
          throw new Error("History object key is not a string.");
        this.state.token = { kind: "string", buffer: "", key: true };
        continue;
      }
      if (this.state.root && !frame)
        throw new Error("History contains trailing content.");
      if (char === "{" || char === "[") {
        if (this.state.frames.length >= 256)
          throw new Error(
            "History exceeds the supported nesting depth; original data has been preserved."
          );
        this.state.frames.push({
          kind: char === "{" ? "object" : "array",
          ref: this.nodes.create(char === "{" ? {} : []),
          count: 0,
          state: char === "{" ? "key" : "value"
        });
      } else if (char === '"')
        this.state.token = { kind: "string", buffer: "", key: false };
      else if (/^[-\d]$/.test(char))
        this.state.token = { kind: "number", buffer: char, key: false };
      else if (/^[tfn]$/.test(char))
        this.state.token = { kind: "literal", buffer: char, key: false };
      else throw new Error("History contains an unexpected JSON token.");
    }
  }

  finish(): ValueRef {
    if (this.state.token && this.state.token.kind !== "string")
      this.primitive(this.state.token);
    if (this.state.frames.length || this.state.token || !this.state.root)
      throw new Error(
        "History JSON is incomplete; original data has been preserved."
      );
    return this.state.root;
  }
}
