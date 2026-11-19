import type { LongForeshadowing } from "./plot";

const FORESHADOWING_SECTIONS = [
  ["coreQuestion", "核心问题"],
  ["hiddenTruth", "隐藏真相"],
  ["expectedReaderEffect", "预期读者效果"]
] as const;

export function serializeLongForeshadowingBody(
  thread: Pick<
    LongForeshadowing,
    "coreQuestion" | "hiddenTruth" | "expectedReaderEffect"
  >
): string {
  return FORESHADOWING_SECTIONS.map(
    ([field, label]) => `## ${label}\n\n${(thread[field] ?? "").trim()}`
  ).join("\n\n");
}

export function parseLongForeshadowingBody(body: string): {
  coreQuestion: string;
  hiddenTruth: string;
  expectedReaderEffect: string;
} {
  const parsed = {
    coreQuestion: "",
    hiddenTruth: "",
    expectedReaderEffect: ""
  };
  let current: keyof typeof parsed | undefined;
  const buffers = new Map<keyof typeof parsed, string[]>();
  for (const line of body.replaceAll("\r\n", "\n").split("\n")) {
    const heading = /^#{1,6}\s+(.+?)\s*$/u.exec(line);
    const section = heading
      ? FORESHADOWING_SECTIONS.find(([, label]) => label === heading[1])
      : undefined;
    if (section) {
      current = section[0];
      buffers.set(current, []);
      continue;
    }
    if (current) buffers.get(current)!.push(line);
  }
  for (const [field] of FORESHADOWING_SECTIONS) {
    parsed[field] = (buffers.get(field) ?? []).join("\n").trim();
  }
  return parsed;
}
