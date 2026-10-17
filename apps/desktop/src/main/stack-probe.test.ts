import { it } from "vitest";

// Throwaway diagnostic: verify whether AppIcon.vue alone trips the Windows
// module evaluator, then whether the full graph still fails. Delete after
// diagnosing.
it("probes renderer component imports without vite-ignore", async () => {
  const out: string[] = [];
  const record = async (label: string, load: () => Promise<unknown>) => {
    try {
      await load();
      out.push(`${label}: ok`);
    } catch (error) {
      out.push(
        `${label}: FAIL ${error instanceof Error ? error.stack : String(error)}`
      );
    }
  };
  await record(
    "AppIcon",
    () => import("../renderer/src/components/AppIcon.vue")
  );
  await record(
    "AppIcon again",
    () => import("../renderer/src/components/AppIcon.vue")
  );
  await record(
    "LibraryGroupActionMenu",
    () => import("../renderer/src/components/LibraryGroupActionMenu.vue")
  );
  await record(
    "AgentTeamSaveBar",
    () => import("../renderer/src/components/AgentTeamSaveBar.vue")
  );
  console.error("PROBE2-BEGIN");
  console.error(out.join("\n"));
  console.error("PROBE2-END");
});
