import { describe, expect, it } from "vitest";
import type { ContextMenuParams } from "electron";
import type { TextContextMenuContext } from "@deepwrite/contracts";
import {
  buildTextMenuItems,
  fallbackTextContext
} from "./text-context-menu-items";

const params = {
  isEditable: true,
  selectionText: "",
  formControlType: "text-area",
  editFlags: {
    canUndo: true,
    canRedo: false,
    canCut: true,
    canCopy: true,
    canPaste: true,
    canDelete: true,
    canSelectAll: true
  }
} as ContextMenuParams;
const context: TextContextMenuContext = {
  kind: "editable",
  password: false,
  hasSelection: true,
  hasText: true,
  canInsertReference: false,
  canInsertImage: false
};
const build = (
  overrides: Partial<TextContextMenuContext> = {},
  clipboard = true
) =>
  buildTextMenuItems(params, { ...context, ...overrides }, clipboard, "darwin");

describe("native text menu policy", () => {
  it("offers the image insertion submenu only for registered non-password targets", () => {
    const items = build({
      kind: "readonly",
      hasSelection: false,
      canInsertImage: true
    });
    expect(items.at(-2)?.type).toBe("separator");
    expect(items.at(-1)?.submenu).toEqual([
      { action: "insertImage", label: "图片…", enabled: true }
    ]);
    expect(build().some((item) => item.submenu)).toBe(false);
    expect(
      build({ canInsertImage: true, password: true }).some(
        (item) => item.submenu
      )
    ).toBe(false);
    expect(build({ kind: "none", canInsertImage: true })).toEqual([]);
  });
  it("groups editing actions in the expected order", () => {
    expect(build().map((item) => item.action ?? item.type)).toEqual([
      "undo",
      "redo",
      "separator",
      "cut",
      "copy",
      "paste",
      "delete",
      "separator",
      "selectAll"
    ]);
  });
  it("disables selection operations and empty clipboard paste", () => {
    const items = build({ hasSelection: false, hasText: false }, false);
    for (const action of [
      "cut",
      "copy",
      "delete",
      "selectAll",
      "paste",
      "redo"
    ])
      expect(items.find((item) => item.action === action)?.enabled).toBe(false);
  });
  it("provides only copy and select all in readonly text fields", () => {
    expect(
      build({ kind: "readonly" }).map((item) => item.action ?? item.type)
    ).toEqual(["copy", "separator", "selectAll"]);
  });
  it("adds reference insertion to selected content, but not empty or password fields", () => {
    expect(
      build({
        kind: "selection",
        canInsertReference: true,
        canInsertImage: false
      }).map((item) => item.action ?? item.type)
    ).toEqual(["insertReference", "separator", "copy"]);
    expect(
      build({
        canInsertReference: true,
        canInsertImage: false,
        hasSelection: false
      }).some((item) => item.action === "insertReference")
    ).toBe(false);
    const passwordItems = build({
      password: true,
      canInsertReference: true,
      canInsertImage: false
    });
    expect(passwordItems.find((item) => item.action === "copy")?.enabled).toBe(
      false
    );
    expect(passwordItems.find((item) => item.action === "cut")?.enabled).toBe(
      false
    );
    expect(
      passwordItems.some((item) => item.action === "insertReference")
    ).toBe(false);
  });
  it("uses the editor history for undo/redo, including programmatic edits", () => {
    const items = build({ history: { canUndo: false, canRedo: true } });
    expect(items.find((item) => item.action === "undo")?.enabled).toBe(false);
    expect(items.find((item) => item.action === "redo")?.enabled).toBe(true);
    const windowsItems = buildTextMenuItems(params, context, true, "win32");
    expect(
      windowsItems.find((item) => item.action === "redo")?.accelerator
    ).toBe("Control+Y");
  });
  it("does not create menus for excluded targets and has a native-only fallback", () => {
    expect(build({ kind: "none" })).toEqual([]);
    expect(fallbackTextContext(params)).toMatchObject({
      kind: "editable",
      canInsertReference: false,
      canInsertImage: false
    });
    expect(fallbackTextContext({ ...params, isEditable: false })).toMatchObject(
      { kind: "none" }
    );
  });
  it("respects native restrictions and selection for input types without DOM selection offsets", () => {
    const items = buildTextMenuItems(
      {
        ...params,
        selectionText: "sample",
        editFlags: { ...params.editFlags, canCopy: false, canPaste: false }
      },
      { ...context, hasSelection: false },
      true,
      "win32"
    );
    expect(items.find((item) => item.action === "copy")?.enabled).toBe(false);
    expect(items.find((item) => item.action === "paste")?.enabled).toBe(false);
    expect(items.find((item) => item.action === "delete")?.enabled).toBe(true);
  });
});
