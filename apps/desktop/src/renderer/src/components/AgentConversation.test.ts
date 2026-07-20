import { describe, expect, it } from "vitest";
import source from "./AgentConversation.vue?raw";

describe("AgentConversation edit proposal placement", () => {
  it("keeps edit proposals above the completed response actions", () => {
    const messageBodyStart = source.indexOf('<div class="message-body">');
    const responseStart = source.indexOf('v-else-if="visibleResponse(message)"', messageBodyStart);
    const proposalsStart = source.indexOf('class="edit-proposal-list"', responseStart);
    const actionsStart = source.indexOf('class="message-actions"', proposalsStart);

    expect(messageBodyStart).toBeGreaterThan(-1);
    expect(responseStart).toBeGreaterThan(messageBodyStart);
    expect(proposalsStart).toBeGreaterThan(responseStart);
    expect(actionsStart).toBeGreaterThan(proposalsStart);
  });

  it("only lists configured models in the composer model selector", () => {
    expect(source).toContain("props.models.map");
    expect(source).toContain('placeholder="选择模型"');
    expect(source).not.toContain('{ value: "", label: "DeepWrite Faux" }');
  });
});
