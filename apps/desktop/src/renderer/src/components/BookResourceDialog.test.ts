import { describe, expect, it } from "vitest";
import { sourceTextIndexOf } from "../../../test-utils/sourceText";
import appSource from "../WorkspaceShell.vue?raw";
import lifecycleSource from "../composables/useShortBookLifecycleCoordinator.ts?raw";
import dialogSource from "./BookResourceDialog.vue?raw";

describe("BookResourceDialog binding editor", () => {
  it("matches the create-book binding layout and supports library or group selection", () => {
    expect(dialogSource).toContain("create-short-binding-panel");
    expect(dialogSource).toContain("lib-picker-groups");
    expect(dialogSource).toContain("lib-picker-toolbar");
    expect(dialogSource).toContain("lib-picker-list");
    expect(dialogSource).toContain("<PopupSelect");
    expect(dialogSource).toContain("toggleGroup");
  });

  it("submits categorized bindings without flattening away their purpose", () => {
    expect(dialogSource).toContain('domain: "material"');
    expect(dialogSource).toContain('domain: "skill"');
    expect(dialogSource).toContain("linksByKind");
    expect(lifecycleSource).toContain(
      "linkedSkillIdsByKind: payload.linksByKind"
    );
    expect(lifecycleSource).toContain(
      "linkedMaterialIdsByKind: payload.linksByKind"
    );
    expect(appSource).toContain('@update-book-bindings="updateBookBindings"');
  });

  it("offers the shared library pool to short and script books", () => {
    expect(appSource).not.toContain("library.skillType === workspaceType");
    expect(appSource).not.toContain("library.materialType === workspaceType");
    expect(appSource).toContain("return catalogSnapshot.value.skills");
    expect(appSource).toContain("return catalogSnapshot.value.materials");
    expect(dialogSource).toContain('props.book?.workspaceType === "script"');
  });

  it("keeps the binding dialog footer steady while libraries load", () => {
    const actionsStart = sourceTextIndexOf(
      dialogSource,
      '<div class="dialog-actions" :class="{ \'create-short-book-actions\': bindingDomain }">'
    );
    const statusStart = sourceTextIndexOf(
      dialogSource,
      'class="dialog-action-status"',
      actionsStart
    );
    const cancelStart = sourceTextIndexOf(
      dialogSource,
      'class="dialog-secondary-button"',
      actionsStart
    );

    expect(actionsStart).toBeGreaterThan(-1);
    expect(statusStart).toBeGreaterThan(actionsStart);
    expect(statusStart).toBeLessThan(cancelStart);
    expect(dialogSource).not.toContain(
      '<p v-if="bindingDomain && loading" class="create-short-stable-hint"'
    );
  });
});
