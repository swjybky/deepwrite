import { describe, expect, it } from "vitest";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import rendererStyles from "virtual:deepwrite-renderer-styles";
import conversationSource from "./AgentConversation.vue?raw";
import composerSource from "./ConversationComposer.vue?raw";
import modelConfigSource from "./ConversationModelConfigSelect.vue?raw";
import indicatorSource from "./ContextWindowIndicator.vue?raw";
import chatAssistantComposerSource from "../features/chat-assistant/ChatAssistantComposer.vue?raw";

describe("ContextWindowIndicator", () => {
  it("shows the indicator in the composer rather than behind a disclosure", () => {
    const indicator = composerSource.indexOf("<ContextWindowIndicator");
    expect(indicator).toBeGreaterThan(-1);
    // Sits with the composer, not inside the collapsed "更多" menu: how full the
    // context is decides whether the next send overflows, so it must be visible
    // without a click.
    const menu = composerSource.indexOf("<ComposerMoreSettings>");
    const menuEnd = composerSource.indexOf("</ComposerMoreSettings>");
    expect(menu).toBeGreaterThan(-1);
    expect(menuEnd).toBeGreaterThan(menu);
    expect(indicator < menu || indicator > menuEnd).toBe(true);
    expect(modelConfigSource).toContain("思考等级");
    expect(modelConfigSource).toContain("温度");
    expect(composerSource).not.toContain('accessible-label="选择温度"');
  });

  it("is limited to the shared creative composer", () => {
    expect(conversationSource).toContain("<ConversationComposer");
    expect(composerSource).toContain("<ContextWindowIndicator");
    expect(composerSource).toContain(
      'v-if="settingsStore.generalSettings.showContextUsage"'
    );
    expect(chatAssistantComposerSource).not.toContain("ContextWindowIndicator");
  });

  it("teleports a keyboard-accessible tooltip outside the clipped composer", () => {
    expect(indicatorSource).toContain('<Teleport to="body">');
    expect(indicatorSource).toContain('role="tooltip"');
    expect(indicatorSource).toContain('@focus="focused = true"');
    expect(indicatorSource).toContain('@keydown.esc.prevent="closeTooltip"');
    expect(indicatorSource).toContain("getBoundingClientRect()");
    expect(indicatorSource).toContain("window.innerWidth");
    expect(rendererStyles).toContain("position: fixed;");
  });

  it("uses theme variables and renders a full-width usage bar", () => {
    expect(rendererStyles).toContain("var(--surface-raised");
    expect(rendererStyles).toContain("var(--theme-line");
    expect(rendererStyles).toContain("var(--text-primary");
    expect(rendererStyles).toContain("var(--accent");
    // A bar and not a ring: the fill width carries the ratio.
    expect(indicatorSource).toContain("context-window-indicator-fill");
    expect(indicatorSource).toContain("usedPercentage ?? 0");
    // Escalates before the window is gone, and stays reachable for users who
    // ask for reduced motion.
    expect(rendererStyles).toContain('[data-state="warning"]');
    expect(rendererStyles).toContain('[data-state="over-limit"]');
    expect(rendererStyles).toContain("prefers-reduced-motion: reduce");
  });

  it("shows actual percentages, exact tokens, and explicit unmeasured states", () => {
    expect(indicatorSource).toContain("已使用 ${usedPercentageLabel.value}");
    expect(indicatorSource).toContain("等待实际用量");
    expect(indicatorSource).toContain("上下文上限不可用");
    expect(indicatorSource).toContain("tokens`");
    // The strip shows the model's own numbers, not a bare percentage.
    expect(indicatorSource).toContain("tokenRatioLabel ?");
    expect(indicatorSource).toContain("context-window-indicator-value");
  });
});
