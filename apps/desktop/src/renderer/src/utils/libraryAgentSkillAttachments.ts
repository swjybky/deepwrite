import {
  ATTACHED_CONTEXT_MAX_CONTENT_LENGTH,
  ATTACHED_CONTEXT_MAX_ITEMS,
  type LibraryAgentSkill
} from "@deepwrite/contracts";
import type { WorkspaceRuntimeContext } from "@deepwrite/contracts";

type AttachedSkill = NonNullable<WorkspaceRuntimeContext["attachedSkills"]>[number];

export type LibraryAgentSkillAttachmentDiagnosticCode =
  | "content-truncated"
  | "capacity-exceeded";

export interface LibraryAgentSkillAttachmentDiagnostic {
  code: LibraryAgentSkillAttachmentDiagnosticCode;
  message: string;
  skillId?: string;
  originalLength?: number;
  includedLength?: number;
}

export interface BuildLibraryAgentSkillAttachmentsOptions {
  /** May lower, but never raise, the protocol's per-domain item limit. */
  maxItems?: number;
  /** May lower, but never raise, the protocol's per-item content limit. */
  maxContentLength?: number;
}

export interface LibraryAgentSkillAttachmentBuildResult {
  attachedSkills: AttachedSkill[];
  diagnostics: LibraryAgentSkillAttachmentDiagnostic[];
  complete: boolean;
}

function protocolLimit(requested: number | undefined, maximum: number): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return maximum;
  }
  return Math.min(maximum, Math.max(0, Math.floor(requested)));
}

function truncateContent(
  skill: LibraryAgentSkill,
  maxContentLength: number,
  diagnostics: LibraryAgentSkillAttachmentDiagnostic[]
): string {
  if (skill.content.length <= maxContentLength) {
    return skill.content;
  }
  const marker = `\n\n[DeepWrite：附件内容因 ${maxContentLength.toLocaleString("zh-CN")} 字符上限截断；原文 ${skill.content.length.toLocaleString("zh-CN")} 字符。]`;
  const content =
    marker.length >= maxContentLength
      ? marker.slice(0, maxContentLength)
      : `${skill.content.slice(0, maxContentLength - marker.length)}${marker}`;
  diagnostics.push({
    code: "content-truncated",
    message: `“${skill.name}”超过附件内容上限，已携带显式截断说明。`,
    skillId: skill.id,
    originalLength: skill.content.length,
    includedLength: content.length
  });
  return content;
}

/**
 * Builds on-demand skill attachments for material / skill library agents from
 * configured settings skills. load_skill resolves by skill name at runtime.
 */
export function buildLibraryAgentSkillAttachments(
  configuredSkills: readonly LibraryAgentSkill[],
  options: BuildLibraryAgentSkillAttachmentsOptions = {}
): LibraryAgentSkillAttachmentBuildResult {
  const diagnostics: LibraryAgentSkillAttachmentDiagnostic[] = [];
  if (!configuredSkills.length) {
    return {
      attachedSkills: [],
      diagnostics,
      complete: true
    };
  }

  const itemLimit = protocolLimit(options.maxItems, ATTACHED_CONTEXT_MAX_ITEMS);
  const contentLimit = protocolLimit(
    options.maxContentLength,
    ATTACHED_CONTEXT_MAX_CONTENT_LENGTH
  );
  const omitted = configuredSkills.slice(itemLimit);
  if (omitted.length) {
    diagnostics.push({
      code: "capacity-exceeded",
      message: `资料库智能体可用技能超过契约容量 ${itemLimit} 条，另有 ${omitted.length} 条未附加。`
    });
  }

  const attachedSkills: AttachedSkill[] = configuredSkills.slice(0, itemLimit).map((skill) => ({
    id: `library-agent-skill:${skill.id}`,
    title: skill.name,
    content: truncateContent(skill, contentLimit, diagnostics),
    source: "attached-skill" as const
  }));

  return {
    attachedSkills,
    diagnostics,
    complete: diagnostics.length === 0
  };
}

export { ATTACHED_CONTEXT_MAX_ITEMS, ATTACHED_CONTEXT_MAX_CONTENT_LENGTH };
