import { ref } from "vue";
import { describe, expect, it } from "vitest";
import { useBookPanePreferenceKey } from "./useBookPanePreferenceKey";

describe("book pane preference navigation", () => {
  it("isolates mystery widths from the previous document and from other mystery books", () => {
    const mysteryBookId = ref<string | null>("mystery-one");
    const key = useBookPanePreferenceKey({
      document: ref({
        domain: "creation",
        workspaceType: "short",
        workspaceId: "short-one"
      }),
      longWorkspaceActive: ref(false),
      longBookId: ref(null),
      mysteryBookId
    });
    expect(key.value).toBe("mystery:book:mystery-one");
    mysteryBookId.value = "mystery-two";
    expect(key.value).toBe("mystery:book:mystery-two");
    mysteryBookId.value = null;
    expect(key.value).toBe("short:book:short-one");
  });

  it.each(["short", "script"] as const)(
    "shares all %s stages and sections within a book, but isolates books",
    (workspaceType) => {
      const document = ref({
        domain: "creation",
        workspaceType,
        workspaceId: "book-1",
        stageId: "character_design",
        id: "character-overview"
      });
      const key = useBookPanePreferenceKey({
        document,
        longWorkspaceActive: ref(false),
        longBookId: ref(null)
      });
      const originalKey = key.value;
      for (const stageId of ["plot_design", "plot_refine", "draft"]) {
        document.value = { ...document.value, stageId, id: `${stageId}-1` };
        expect(key.value).toBe(originalKey);
        document.value.id = `${stageId}-2`;
        expect(key.value).toBe(originalKey);
      }
      document.value.workspaceId = "book-2";
      expect(key.value).not.toBe(originalKey);
      document.value.workspaceId = "book-1";
      expect(key.value).toBe(originalKey);
      document.value.domain = "material";
      expect(key.value).toBeUndefined();
    }
  );

  it("uses the active long book instead of a stale short document", () => {
    const longBookId = ref<string | null>("long-book-1");
    const longWorkspaceActive = ref(true);
    const key = useBookPanePreferenceKey({
      document: ref({
        domain: "creation",
        workspaceType: "short",
        workspaceId: "short-book-1"
      }),
      longWorkspaceActive,
      longBookId
    });
    expect(key.value).toBe("long:book:long-book-1");
    longBookId.value = "long-book-2";
    expect(key.value).toBe("long:book:long-book-2");
    longBookId.value = null;
    expect(key.value).toBeUndefined();
    longWorkspaceActive.value = false;
    expect(key.value).toBe("short:book:short-book-1");
  });
});
