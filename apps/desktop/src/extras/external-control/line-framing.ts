const NEWLINE = 0x0a;

interface LineReaderOptions {
  maxBytes(): number;
  onLine(line: string): void;
  onOverflow(): void;
}

/** Splits on bytes, so a character cut across two chunks stays intact. */
export function createLineReader(options: LineReaderOptions) {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let overflowed = false;

  function take(tail: Buffer): string {
    const line = Buffer.concat([...pending, tail]).toString("utf8");
    pending = [];
    pendingBytes = 0;
    return line;
  }

  return {
    push(chunk: Buffer): void {
      let rest = chunk;
      while (!overflowed) {
        const newline = rest.indexOf(NEWLINE);
        const bytes = pendingBytes + (newline < 0 ? rest.length : newline);
        if (bytes > options.maxBytes()) {
          overflowed = true;
          pending = [];
          pendingBytes = 0;
          options.onOverflow();
          return;
        }
        if (newline < 0) {
          if (rest.length > 0) {
            pending.push(rest);
            pendingBytes += rest.length;
          }
          return;
        }
        options.onLine(take(rest.subarray(0, newline)));
        rest = rest.subarray(newline + 1);
      }
    }
  };
}

export function encodeLine(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}
