import { randomUUID } from "node:crypto";
import {
  createEnvelope,
  estimateTextTokens,
  LongReadDocumentResultSchema,
  LongWorkspaceIndexResultSchema
} from "@deepwrite/contracts";
import type { AgentRunInput } from "./runtime-types";
import type { ContextRefs, ContextTaskKind } from "./kernel/context";
import { LONG_STAGE_ROOTS } from "./long-agent-tools/entity-registry";
import { resolveLongTarget } from "./long-agent-tools/target";

const TAIL_LENGTH = 1_500;

function skillSection(
  input: AgentRunInput,
  titles: readonly string[],
  budget: number
): string {
  const attached = input.workspaceContext?.attachedSkills ?? [];
  const kinds: readonly string[] =
    input.longAgentProfile?.readAccess.skillKinds ??
    input.scriptAgentProfile?.readAccess.skill ??
    input.agentProfile?.readAccess.skill ??
    [];
  const names = new Set(
    input.libraryAgentProfile?.readAccess.skills.map((item) => item.name)
  );
  const lines: string[] = [];
  let used = 0;
  for (const title of [...titles].reverse()) {
    const matches = attached.filter(
      (item) =>
        item.title === title &&
        (input.libraryAgentProfile
          ? names.has(item.title)
          : item.kind !== undefined && kinds.includes(item.kind))
    );
    // A title that became ambiguous must be resolved through load_skill again.
    if (matches.length !== 1) continue;
    const skill = matches[0]!;
    const full = `### 已加载技能：${skill.title}（${skill.id}，本轮版本）\n${skill.content}`;
    const text =
      used + estimateTextTokens(full) <= budget
        ? full
        : `技能「${skill.title}」超过恢复预算，需要时重新 load_skill。`;
    const tokens = estimateTextTokens(text + "\n\n");
    if (used + tokens > budget) continue;
    used += tokens;
    lines.push(text);
  }
  return lines.join("\n\n");
}

function shortTail(
  input: AgentRunInput,
  refs: ContextRefs,
  limit: number
): string | undefined {
  const workspace =
    input.workspaceContext?.scriptWorkspace ??
    input.workspaceContext?.shortWorkspace;
  if (!workspace) return undefined;
  if (workspace.readSource === "core")
    return input.promptLocale === "en-US"
      ? "For continuity, read the current manuscript or State by id from Core before continuing."
      : "续写前请按 id 从 Core 读取当前正文或状态，衔接最新保存的内容。";
  const sections = workspace.expertDraft.sections;
  const refIds = [...refs.proposed, ...refs.read]
    .map((ref) => ref.split(/[: /@]/))
    .flat();
  const section =
    sections.find((item) => item.id === workspace.activeSectionId) ??
    [...sections].reverse().find((item) => refIds.includes(item.id));
  if (!section?.body.content.trim()) return undefined;
  return `### 续写衔接：${section.title}（${section.id}，发送时版本）结尾\n${Array.from(section.body.content.trimEnd()).slice(-limit).join("")}\n此片段不代表已完整读取；修改前仍须 read。`;
}

/** Read only the authoritative chapter tail through the existing authorized
 * Core bridge. It confers no full-read credential on the writing tools. */
async function longTail(
  input: AgentRunInput,
  limit: number
): Promise<string | undefined> {
  const workspace = input.workspaceContext?.longWorkspace;
  const chapter = workspace?.activeChapterCardId;
  const execute = input.longCommandExecutor;
  if (
    !workspace ||
    !chapter ||
    !execute ||
    !input.longAgentProfile?.readAccess.workspaceRoots.includes(
      LONG_STAGE_ROOTS.draft
    )
  )
    return undefined;
  const signal = AbortSignal.any([
    ...(input.signal ? [input.signal] : []),
    AbortSignal.timeout(10_000)
  ]);
  const context = {
    runId: input.runId,
    sessionId: input.sessionId,
    resourceId: workspace.bookId
  };
  const indexReply = await execute(
    createEnvelope(
      "long.getWorkspaceIndex",
      { bookId: workspace.bookId },
      { id: randomUUID(), context }
    ),
    signal
  );
  if (indexReply.status !== "accepted") return undefined;
  const index = LongWorkspaceIndexResultSchema.parse(indexReply.payload);
  if (index.bookId !== workspace.bookId)
    throw new Error("恢复正文时作品不匹配。");
  const target = resolveLongTarget(index.workspaceIndex, {
    id: chapter,
    document: "body"
  });
  if (target.addressing !== "document" || target.inlineContent !== undefined)
    return undefined;
  const read = async (offset: number, maxCharacters: number) => {
    const reply = await execute(
      createEnvelope(
        "long.readDocument",
        {
          bookId: workspace.bookId,
          fileId: target.file.id,
          offset,
          maxCharacters
        },
        { id: randomUUID(), context }
      ),
      signal
    );
    if (reply.status !== "accepted") throw new Error("读取正文结尾失败。");
    const result = LongReadDocumentResultSchema.parse(reply.payload);
    if (
      result.bookId !== workspace.bookId ||
      result.file.id !== target.file.id ||
      result.offset !== offset
    )
      throw new Error("恢复正文时文档不匹配。");
    return result;
  };
  const probe = await read(0, 1);
  const tail = await read(Math.max(0, probe.totalCharacters - limit), limit);
  if (
    probe.file.updatedAt !== tail.file.updatedAt ||
    probe.totalCharacters !== tail.totalCharacters
  )
    return undefined;
  return `### 续写衔接：${target.title}（${chapter}/body，Core 当前保存版本 ${tail.file.updatedAt}）结尾\n${tail.content}\n未接受的提案不在此片段中；修改前仍须 read 完整读取。`;
}

export async function rehydrateWorkspaceContext(
  input: AgentRunInput,
  task: ContextTaskKind,
  refs: ContextRefs,
  budget: number
): Promise<string | undefined> {
  let tail: string | undefined;
  const limit = Math.max(1, Math.min(TAIL_LENGTH, Math.floor(budget * 0.4)));
  if (task === "short-draft" || task === "script")
    tail = shortTail(input, refs, limit);
  if (task === "long") {
    try {
      tail = await longTail(input, limit);
    } catch {
      input.signal?.throwIfAborted();
      tail = "未能恢复当前章正文结尾，续写前请用 read 重新读取。";
    }
  }
  if (tail && estimateTextTokens(tail) > budget * 0.75) tail = undefined;
  const skills = skillSection(
    input,
    refs.skills,
    budget - (tail ? estimateTextTokens(tail + "\n\n") : 0)
  );
  return [skills, tail].filter(Boolean).join("\n\n") || undefined;
}
