export interface MarkdownMetadataFields {
  name: string;
  description: string;
}

export type MarkdownMetadataEditResult =
  { updated: true; content: string } | { updated: false; message: string };

/** Callers validate the header and serialize values using their own format rules. */
export function writeMarkdownMetadataFields(
  content: string,
  headerEnd: number | undefined,
  values: MarkdownMetadataFields
): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const keys = ["name", "description"] as const;
  const fields = keys.map((key) => `${key}: ${values[key]}`);
  if (headerEnd === undefined) {
    const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
    return `${bom}---${newline}${fields.join(newline)}${newline}---${newline}${newline}${content.slice(bom.length)}`;
  }
  const header = content.slice(0, headerEnd).split(/\r?\n/);
  const closing = header.lastIndexOf("---");
  const missing: string[] = [];
  for (const [index, key] of keys.entries()) {
    const target = header.findIndex((line) =>
      new RegExp(`^${key}\\s*:`).test(line)
    );
    if (target >= 0) header[target] = fields[index]!;
    else missing.push(fields[index]!);
  }
  header.splice(closing, 0, ...missing);
  return header.join(newline) + content.slice(headerEnd);
}
