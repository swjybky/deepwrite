import { inputRules, textblockTypeInputRule } from "prosemirror-inputrules";
import { richMarkdownSchema as schema } from "./schema";

export function richMarkdownInputRules() {
  const heading = textblockTypeInputRule(
    /^(#{1,6}) $/u,
    schema.nodes.heading!,
    (match) => ({ level: match[1]!.length })
  );
  heading.inCodeMark = false;
  return inputRules({ rules: [heading] });
}
