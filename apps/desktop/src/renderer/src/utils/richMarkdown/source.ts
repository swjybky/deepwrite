import type { Node } from "prosemirror-model";
import {
  EditorState,
  TextSelection,
  type Transaction
} from "prosemirror-state";
import { richMarkdownParsers, serializeRichBlock } from "./markdown";
import {
  imageTailParagraphPosition,
  withImageTailParagraph
} from "./imageEditing";
import { buildMyersOperations, type DiffOperation } from "../boundedMyersDiff";

export interface RichMarkdownBlock {
  node: Node;
  position: number;
  start: number;
  end: number;
  before: string;
  text: string;
}
interface OriginalBlock {
  first: number;
  last: number;
  start: number;
  end: number;
  text: string;
}

/** Untouched nodes retain their original Markdown, including unsupported literal text. */
export class RichMarkdownSource {
  readonly document: Node;
  private originals = new WeakMap<Node, OriginalBlock>();
  private origins = new WeakMap<Node, OriginalBlock>();
  private alignments = new WeakMap<
    Node,
    { canonical: string; operations: DiffOperation[] | undefined }
  >();
  private prefix = "";
  private suffix = "";
  constructor(
    readonly original: string,
    images: boolean
  ) {
    const parser = images
      ? richMarkdownParsers.book
      : richMarkdownParsers.plain;
    this.document = withImageTailParagraph(parser.parse(original));
    const offsets = [0];
    for (let index = 0; index < original.length; index += 1)
      if (original[index] === "\n") offsets.push(index + 1);
    const ranges: { start: number; end: number }[] = [];
    let depth = 0;
    for (const token of parser.tokenizer.parse(original, {})) {
      if (depth === 0 && token.map && token.nesting >= 0) {
        const start = offsets[token.map[0]] ?? original.length;
        let end = offsets[token.map[1]] ?? original.length;
        if (original[end - 1] === "\n") end -= 1;
        if (original[end - 1] === "\r") end -= 1;
        ranges.push({ start, end });
      }
      depth += token.nesting;
    }
    this.document.forEach((node, _position, index) => {
      const range = ranges[index];
      if (range)
        this.originals.set(node, {
          ...range,
          first: index,
          last: index,
          text: original.slice(range.start, range.end)
        });
    });
    this.prefix = original.slice(0, ranges[0]?.start ?? 0);
    this.suffix = original.slice(ranges.at(-1)?.end ?? original.length);
  }
  /** Carry source boundaries through splits/joins, without reusing changed text. */
  track(transaction: Transaction): void {
    const blocks: Node[] = [];
    transaction.doc.forEach((node) => blocks.push(node));
    const mapped = new Map<number, OriginalBlock>();
    transaction.before.forEach((node, position) => {
      const origin = this.originals.get(node) ?? this.origins.get(node);
      if (!origin) return;
      const start = transaction.mapping.map(position, 1);
      const end = transaction.mapping.map(position + node.nodeSize, -1);
      if (end <= start) return;
      const from = transaction.doc.resolve(start).index(0);
      const to = transaction.doc.resolve(end);
      const last = to.index(0) - (to.depth === 0 ? 1 : 0);
      for (let index = from; index <= last; index += 1) {
        const previous = mapped.get(index);
        mapped.set(
          index,
          previous
            ? { ...previous, last: origin.last, end: origin.end }
            : origin
        );
      }
    });
    for (const [index, origin] of mapped)
      this.origins.set(blocks[index]!, origin);
  }
  blocks(document: Node): RichMarkdownBlock[] {
    const result: RichMarkdownBlock[] = [];
    let previous: OriginalBlock | undefined;
    let offset = this.prefix.length;
    const tailPosition = imageTailParagraphPosition(document);
    document.forEach((node, position) => {
      if (position === tailPosition) {
        const end = offset + this.suffix.length;
        result.push({ node, position, start: end, end, before: "", text: "" });
        return;
      }
      const original = this.originals.get(node);
      const origin = original ?? this.origins.get(node);
      const before = result.length
        ? previous && origin && origin.first === previous.last + 1
          ? this.original.slice(previous.end, origin.start)
          : "\n\n"
        : this.prefix;
      if (result.length) offset += before.length;
      const text = original?.text ?? serializeRichBlock(node);
      result.push({
        node,
        position,
        start: offset,
        end: offset + text.length,
        before,
        text
      });
      offset += text.length;
      previous = origin;
    });
    return result;
  }
  serialize(document: Node): string {
    if (document.eq(this.document)) return this.original;
    const blocks = this.blocks(document);
    if (blocks.length === 1 && !blocks[0]!.text) return "";
    return (
      blocks.map((block) => block.before + block.text).join("") + this.suffix
    );
  }
  offset(document: Node, position: number, end = false): number {
    const blocks = this.blocks(document);
    const block =
      blocks.find((entry) =>
        end
          ? position > entry.position &&
            position <= entry.position + entry.node.nodeSize
          : position >= entry.position &&
            position < entry.position + entry.node.nodeSize
      ) ?? blocks.at(-1);
    if (!block) return 0;
    if (block.node.isAtom || position <= block.position)
      return end ? block.end : block.start;
    if (position >= block.position + block.node.nodeSize) return block.end;
    if (!document.resolve(position).parent.inlineContent) {
      const nearby = TextSelection.near(
        document.resolve(position),
        end ? -1 : 1
      ).from;
      return nearby !== position
        ? this.offset(document, nearby, end)
        : block.start;
    }
    const marker = "\ufdd0";
    const transaction = EditorState.create({ doc: document }).tr.insertText(
      marker,
      position
    );
    const node = transaction.doc.child(document.resolve(position).index(0));
    const marked = serializeRichBlock(node);
    const point = marked.indexOf(marker);
    const canonical = marked.replace(marker, "");
    if (canonical === block.text) return block.start + point;
    let alignment = this.alignments.get(block.node);
    if (alignment?.canonical !== canonical) {
      alignment = {
        canonical,
        operations: buildMyersOperations(
          canonical.split(""),
          block.text.split("")
        )
      };
      this.alignments.set(block.node, alignment);
    }
    let left = 0,
      right = 0;
    if (alignment.operations) {
      for (const operation of alignment.operations) {
        if (operation.type === "context") {
          if (left + operation.text.length >= point)
            return block.start + right + Math.max(0, point - left);
          left += operation.text.length;
          right += operation.text.length;
        } else if (operation.type === "deletion") left += operation.text.length;
        else right += operation.text.length;
      }
      return block.start + right;
    }
    // Keep selection mapping bounded for blocks beyond the diff work budget.
    while (left < point && right < block.text.length) {
      if (canonical[left] === block.text[right]) {
        left += 1;
        right += 1;
      } else if (/[\s*_~`\\#+>\-|]/u.test(canonical[left] ?? "")) left += 1;
      else if (/[\s*_~`\\#+>\-|]/u.test(block.text[right] ?? "")) right += 1;
      else {
        left += 1;
        right += 1;
      }
    }
    return block.start + right;
  }
  position(document: Node, offset: number): number {
    const blocks = this.blocks(document);
    const tail = blocks.at(-1);
    const block =
      tail &&
      tail.position === imageTailParagraphPosition(document) &&
      offset >= tail.start
        ? tail
        : (blocks.find((entry) => offset <= entry.end) ?? tail);
    if (!block) return 0;
    let closest = block.position,
      distance = Infinity;
    document.nodesBetween(
      block.position,
      block.position + block.node.nodeSize,
      (node, position) => {
        if (!node.inlineContent) return;
        let low = position + 1,
          high = low + node.content.size;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (this.offset(document, middle) < offset) low = middle + 1;
          else high = middle;
        }
        const difference = Math.abs(this.offset(document, low) - offset);
        if (difference < distance) {
          distance = difference;
          closest = low;
        }
        return false;
      }
    );
    return closest;
  }
}
