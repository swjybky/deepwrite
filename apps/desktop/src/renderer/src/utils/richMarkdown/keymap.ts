import { baseKeymap, chainCommands, newlineInCode } from "prosemirror-commands";
import type { Command } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import {
  splitListItem,
  sinkListItem,
  liftListItem
} from "prosemirror-schema-list";
import { goToNextCell } from "prosemirror-tables";
import { undoInputRule } from "prosemirror-inputrules";
import { richMarkdownSchema as schema } from "./schema";
import { deleteImageBeforeCursor } from "./imageEditing";

export function richMarkdownKeymap(history: { undo(): void; redo(): void }) {
  const inCell: Command = (state, dispatch) => {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1)
      if (["table_cell", "table_header"].includes($from.node(depth).type.name))
        return goToNextCell(1)(state, dispatch);
    return false;
  };
  return [
    keymap({
      "Mod-z": () => {
        history.undo();
        return true;
      },
      "Shift-Mod-z": () => {
        history.redo();
        return true;
      },
      "Mod-y": () => {
        history.redo();
        return true;
      },
      Backspace: chainCommands(
        undoInputRule,
        deleteImageBeforeCursor,
        baseKeymap.Backspace!
      ),
      Enter: chainCommands(
        newlineInCode,
        inCell,
        splitListItem(schema.nodes.list_item!),
        baseKeymap.Enter!
      ),
      Tab: chainCommands(
        goToNextCell(1),
        sinkListItem(schema.nodes.list_item!)
      ),
      "Shift-Tab": chainCommands(
        goToNextCell(-1),
        liftListItem(schema.nodes.list_item!)
      ),
      "Shift-Enter": chainCommands(inCell, (state, dispatch) => {
        dispatch?.(
          state.tr
            .replaceSelectionWith(schema.nodes.hard_break!.create())
            .scrollIntoView()
        );
        return true;
      })
    }),
    keymap(baseKeymap)
  ];
}
