import { describe, expect, it } from "vitest";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import rendererStyles from "virtual:deepwrite-renderer-styles";

describe("SubagentRunList parent-delegated task", () => {
  it("keeps wrapped long assigned tasks readable after expanding the card", () => {
    expect(rendererStyles).toContain(".subagent-run-assigned-task > p");
    expect(rendererStyles).toContain("white-space: pre-wrap;");
    expect(rendererStyles).not.toContain(".subagent-task-preview {");
  });
});
