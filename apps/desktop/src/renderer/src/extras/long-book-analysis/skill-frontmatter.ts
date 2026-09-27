import {
  readSkillMarkdownMetadata,
  updateSkillMarkdownMetadata
} from "@deepwrite/contracts/renderer";

/**
 * A skill entry has to open with YAML frontmatter: the library editor flags it
 * as "技能格式错误 · 首行缺少 ---" and the agent's skill tools refuse it otherwise.
 * The preset prompt asks the model for that header, but a model that skips it
 * would otherwise leave an unusable entry behind — and inside an unattended
 * batch nobody is watching to fix it.
 *
 * Existing fields are kept as the model wrote them; only what is missing falls
 * back to the preset's own name and description.
 */
export function ensureSkillFrontmatter(
  content: string,
  fallbackName: string,
  fallbackDescription: string
): string {
  const existing = readSkillMarkdownMetadata(content);
  const result = updateSkillMarkdownMetadata(content, {
    name: existing.name?.trim() || fallbackName,
    description: existing.description?.trim() || fallbackDescription
  });
  // Refused — a duplicated or multi-line header. Hand back the content untouched
  // rather than risk mangling a header the user wrote by hand.
  return result.updated ? result.content : content;
}
