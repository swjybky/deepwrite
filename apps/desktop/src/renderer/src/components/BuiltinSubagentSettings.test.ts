import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it, vi } from "vitest";
import { defaultBuiltinSubagentSettings } from "@deepwrite/contracts";
import SettingsPanel from "./BuiltinSubagentSettings.vue";

vi.mock("../composables/useBuiltinSubagentSettings", () => ({
  useBuiltinSubagentSettings: () => ({ setEnabled: vi.fn() })
}));

it("renders three direct switches with their saved states and no editor", async () => {
  const settings = defaultBuiltinSubagentSettings();
  settings.material.enabled = true;
  const html = await renderToString(createSSRApp(SettingsPanel, { settings }));
  const switches = html.match(/<input\b[^>]*>/g) ?? [];

  expect(switches).toHaveLength(3);
  for (const input of switches) {
    expect(input).toContain('role="switch"');
    expect(input).not.toContain("disabled");
  }
  expect(switches[0]).toContain('aria-checked="false"');
  expect(switches[1]).toContain('aria-checked="true"');
  expect(switches[2]).toContain('aria-checked="false"');
  expect(html).not.toMatch(/<(button|form|textarea)\b/);
});
