import { Fragment, type Node } from "prosemirror-model";
import { Plugin, TextSelection, type Command } from "prosemirror-state";

export function withImageTailParagraph(document: Node): Node {
  if (document.lastChild?.type.name !== "image") return document;
  return document.copy(
    document.content.append(
      Fragment.from(document.type.schema.nodes.paragraph!.create())
    )
  );
}

/** This empty paragraph is a cursor position, not additional Markdown content. */
export function imageTailParagraphPosition(document: Node): number | undefined {
  const last = document.lastChild;
  if (
    document.childCount > 1 &&
    last?.type.name === "paragraph" &&
    !last.content.size &&
    document.child(document.childCount - 2).type.name === "image"
  )
    return document.content.size - last.nodeSize;
  return undefined;
}

export function imageEditingPlugin() {
  return new Plugin({
    appendTransaction(transactions, _previous, current) {
      if (!transactions.some((transaction) => transaction.docChanged))
        return null;
      const document = withImageTailParagraph(current.doc);
      return document === current.doc
        ? null
        : current.tr.insert(current.doc.content.size, document.lastChild!);
    }
  });
}

export const deleteImageBeforeCursor: Command = (state, dispatch) => {
  const cursor =
    state.selection instanceof TextSelection ? state.selection.$cursor : null;
  if (!cursor || cursor.parentOffset || cursor.depth !== 1) return false;
  const position = cursor.before();
  const image = state.doc.resolve(position).nodeBefore;
  if (image?.type.name !== "image") return false;
  dispatch?.(
    state.tr.delete(position - image.nodeSize, position).scrollIntoView()
  );
  return true;
};
