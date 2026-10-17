import { it } from "vitest";

// Throwaway diagnostic: reproduction of the Windows collection-time failure
// with per-import results printed. Delete after diagnosing.
it("prints per-import results for renderer components", async () => {
  const targets: Array<[string, string]> = [
    ["AppIcon", "../renderer/src/components/AppIcon.vue"],
    ["LibraryRemovalDialog", "../renderer/src/components/LibraryRemovalDialog.vue"],
    ["LibraryGroupActionMenu", "../renderer/src/components/LibraryGroupActionMenu.vue"],
    ["ConversationMessageItem", "../renderer/src/components/ConversationMessageItem.vue"],
    ["AgentTeamSaveBar", "../renderer/src/components/AgentTeamSaveBar.vue"],
    ["i18nIndex", "../renderer/src/i18n/index.ts"]
  ];
  const results: string[] = [];
  for (const [label, specifier] of targets) {
    try {
      await import(/* @vite-ignore */ specifier);
      results.push(`${label}: ok`);
    } catch (error) {
      results.push(`${label}: ${error instanceof Error ? error.stack : String(error)}`);
    }
  }
  console.error("PROBE-RESULTS-BEGIN");
  console.error(results.join("\n\n"));
  console.error("PROBE-RESULTS-END");
});
