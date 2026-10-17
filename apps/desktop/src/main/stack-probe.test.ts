import { it } from "vitest";

// Throwaway diagnostic: reproduction of the Windows collection-time failure
// with the full stack printed before rethrowing. Delete after diagnosing.
it("prints the module collection stack for renderer suites", async () => {
  try {
    await import("../renderer/src/components/LibraryGroupActionMenu.vue");
  } catch (error) {
    console.error("PROBE-STACK-BEGIN");
    console.error(error instanceof Error ? `${error.stack}` : String(error));
    console.error("PROBE-STACK-END");
    throw error;
  }
});
