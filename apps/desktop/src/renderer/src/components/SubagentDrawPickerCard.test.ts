import { describe, expect, it } from "vitest";
import conversationSource from "./AgentConversation.vue?raw";
import pickerSource from "./SubagentDrawPickerCard.vue?raw";
import compareSource from "./SubagentDrawCompareDialog.vue?raw";
import {
  drawCandidateLength,
  drawCandidateNumber,
  drawSelectionAnswers
} from "./subagentDrawCandidates";

describe("SubagentDrawPickerCard", () => {
  it("answers with one option id and a trimmed, optional note", () => {
    expect(drawSelectionAnswers("c2", "  短一点 ")).toEqual([
      { id: "draw", selectedOptionIds: ["c2"], text: "短一点" }
    ]);
    expect(drawSelectionAnswers("reject", "  ")).toEqual([
      { id: "draw", selectedOptionIds: ["reject"] }
    ]);
    expect(drawCandidateNumber({ index: 2 })).toBe(3);
    expect(drawCandidateLength("标题😀")).toBe(3);
  });

  it("replaces the question card for draw requests", () => {
    expect(conversationSource).toContain("<SubagentDrawPickerCard");
    // A write approval wait takes the slot first; draws come next.
    expect(conversationSource).toContain('v-if="waitingForWriteApproval"');
    expect(conversationSource).toContain('v-else-if="userInputRequest.draw"');
    expect(conversationSource).toContain(
      "<AgentUserInputCard\n            v-else"
    );
  });

  it("shows one candidate at a time behind a horizontal strip", () => {
    expect(pickerSource).toContain('role="tablist"');
    expect(pickerSource).toContain('<StreamedContent :content="active.text"');
    expect(pickerSource).toContain("choose(SUBAGENT_DRAW_REJECT_OPTION_ID)");
    expect(pickerSource).toContain('class="dialog-primary-button"');
    expect(pickerSource).toContain('target?.closest("input, textarea")');
  });

  it("keeps the note and actions outside the part that shrinks", () => {
    // Positional grid rows once handed the stretchy track to the footer when
    // the optional notice was absent, clipping the note and buttons.
    const body = pickerSource.indexOf('class="draw-picker-body"');
    const preview = pickerSource.indexOf('class="draw-picker-preview"');
    const actions = pickerSource.indexOf('class="draw-picker-actions"');
    expect(body).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(body);
    expect(pickerSource.slice(preview, actions)).toMatch(
      /<\/div>\s*<\/div>\s*<footer $/
    );
  });

  it("compares two candidates side by side in a teleported dialog", () => {
    expect(compareSource).toContain('<Teleport to="body">');
    expect(compareSource).toContain('v-for="(paneId, paneIndex) in panes"');
    expect(compareSource).toContain("emit('adopt', paneId)");
    expect(compareSource).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr))"
    );
  });
});
