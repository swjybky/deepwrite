import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../renderer/src/styles.css", import.meta.url), "utf8");

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("AgentConversation diff styles", () => {
  it("wraps long diff lines within the proposal card", () => {
    const contentRule = cssRule(".edit-diff-content");
    const lineRule = cssRule(".edit-diff-line");
    const codeRule = cssRule(".edit-diff-line code");

    expect(contentRule).toMatch(/max-width:\s*100%/);
    expect(contentRule).toMatch(/overflow-x:\s*hidden/);
    expect(lineRule).toMatch(/grid-template-columns:\s*42px 42px 20px minmax\(0, 1fr\)/);
    expect(lineRule).toMatch(/width:\s*100%/);
    expect(codeRule).toMatch(/white-space:\s*pre-wrap/);
    expect(codeRule).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
