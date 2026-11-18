import type {
  JsonObject,
  JsonValue,
  ToolResultMessage
} from "@earendil-works/pi-ai";
import { rehydrateWorkspaceContext } from "./workspace-context-recovery";
import { WEB_TOOL_COMPACTORS } from "./web-search/compactor";
import {
  headTail,
  textOf,
  type ContextPolicy,
  type ContextTaskKind,
  type ToolCompactor
} from "./kernel/context";
import type { AgentRunInput } from "./runtime-types";

const SMALL_RESULT_CHARS = 800;
const SKILL_TITLE = /^【技能：(.+?)】/;

function count(text: string): string {
  return text.length.toLocaleString("zh-CN");
}

function stringArg(
  args: Record<string, unknown>,
  key: string
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** `kind:id/document` as the agent addressed it. */
function targetRef(args: Record<string, unknown>): string | undefined {
  const id = stringArg(args, "id") ?? stringArg(args, "entry_id");
  if (!id) return stringArg(args, "name");
  const kind = stringArg(args, "kind");
  const document = stringArg(args, "document");
  const chapter = stringArg(args, "chapter_id");
  return `${kind ? `${kind}:` : ""}${id}${document ? `/${document}` : ""}${
    chapter ? `@${chapter}` : ""
  }`;
}

function firstLine(result: ToolResultMessage): string {
  return textOf(result.content).split("\n", 1)[0]!.trim().slice(0, 120);
}

/** Old reads leave the context; the work itself stays readable through tools. */
const readCompactor: ToolCompactor = {
  result(result, call) {
    const text = textOf(result.content);
    if (result.isError || text.length <= SMALL_RESULT_CHARS) return undefined;
    const ref = call ? targetRef(call.arguments ?? {}) : undefined;
    return `〔已读取 ${firstLine(result)}${ref ? `（${ref}）` : ""}，共 ${count(
      text
    )} 字。原文已移出上下文；需要引用或修改时请重新读取。〕`;
  },
  refs(call) {
    const ref = targetRef(call.arguments ?? {});
    return ref ? { read: [ref] } : {};
  }
};

const searchCompactor: ToolCompactor = {
  result(result, call) {
    if (result.isError) return undefined;
    const query = call ? stringArg(call.arguments ?? {}, "query") : undefined;
    const count = /命中 (\d+) 条/u.exec(firstLine(result))?.[1];
    return `〔检索过 ${JSON.stringify(query ?? "")}，命中 ${count ?? "若干"} 条；需要时重新检索。〕`;
  }
};

function stubProse(
  value: JsonValue | undefined,
  label: string
): JsonValue | undefined {
  return typeof value === "string" && value.length > 200
    ? `〔${label} ${count(value)} 字，已作为提案提交；以作品当前内容为准〕`
    : value;
}

/** Prose bodies in old mutations are replaced; target, meta and summary stay. */
const mutationCompactor: ToolCompactor = {
  args(args) {
    let changed = false;
    const next: JsonObject = { ...args };
    for (const key of [
      "content",
      "brief",
      "body",
      "state",
      "character_state",
      "document_content",
      "append"
    ]) {
      const stubbed = stubProse(args[key], key === "content" ? "正文" : key);
      if (stubbed !== undefined && stubbed !== args[key]) {
        next[key] = stubbed;
        changed = true;
      }
    }
    if (Array.isArray(args.items)) {
      let itemsChanged = false;
      const stubbedItems = args.items.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return item;
        }
        let itemChanged = false;
        const nextItem: JsonObject = { ...(item as JsonObject) };
        for (const key of ["content", "brief", "body", "state"]) {
          const stubbed = stubProse(
            nextItem[key],
            key === "content" ? "正文" : key
          );
          if (stubbed !== undefined && stubbed !== nextItem[key]) {
            nextItem[key] = stubbed;
            itemChanged = true;
          }
        }
        if (itemChanged) itemsChanged = true;
        return itemChanged ? nextItem : item;
      });
      if (itemsChanged) {
        next.items = stubbedItems;
        changed = true;
      }
    }
    if (Array.isArray(args.replacements)) {
      next.replacements = `〔${args.replacements.length} 处片段替换，已作为提案提交；以作品当前内容为准〕`;
      changed = true;
    }
    if (
      args.documents &&
      typeof args.documents === "object" &&
      !Array.isArray(args.documents)
    ) {
      const documents: JsonObject = { ...(args.documents as JsonObject) };
      for (const key of ["chapter_end_state", "handoff", "world_reveals"]) {
        const stubbed = stubProse(documents[key], key);
        if (stubbed !== undefined && stubbed !== documents[key]) {
          documents[key] = stubbed;
          changed = true;
        }
      }
      if (Array.isArray(documents.characters)) {
        documents.characters = documents.characters.map((character) => {
          if (
            !character ||
            typeof character !== "object" ||
            Array.isArray(character)
          )
            return character;
          const next = { ...character };
          for (const key of ["current_state", "history"]) {
            const stubbed = stubProse(next[key], key);
            if (stubbed !== undefined && stubbed !== next[key]) {
              next[key] = stubbed;
              changed = true;
            }
          }
          return next;
        });
      }
      next.documents = documents;
    }
    return changed ? next : undefined;
  },
  refs(call) {
    const ref = targetRef(call.arguments ?? {});
    return ref ? { proposed: [`${call.name} ${ref}`] } : {};
  }
};

const deleteCompactor: ToolCompactor = {
  refs(call) {
    const ref = targetRef(call.arguments ?? {});
    return ref ? { proposed: [`delete ${ref}`] } : {};
  }
};

const skillCompactor: ToolCompactor = {
  // Keep writing method instructions through L1; L2 rehydrates active skills.
  result: () => undefined,
  refs(_call, result) {
    const title = result
      ? SKILL_TITLE.exec(textOf(result.content))?.[1]
      : undefined;
    return title ? { skills: [title] } : {};
  }
};

const materialCompactor: ToolCompactor = {
  result(result, call) {
    const text = textOf(result.content);
    if (call?.arguments?.mode !== "read" || text.length <= SMALL_RESULT_CHARS) {
      return undefined;
    }
    const name =
      stringArg(call.arguments, "entry_name") ??
      stringArg(call.arguments, "entry_id");
    return `〔已读取素材${name ? `「${name}」` : ""}，共 ${count(
      text
    )} 字。原文已移出上下文；需要时请重新查询。〕`;
  },
  refs(call) {
    const args = call.arguments ?? {};
    const name = stringArg(args, "entry_name") ?? stringArg(args, "entry_id");
    return args.mode === "read" && name ? { materials: [name] } : {};
  }
};

/** User answers are decisions: they are never shortened. */
const keepCompactor: ToolCompactor = { result: () => undefined };

const subagentCompactor: ToolCompactor = {
  result(result) {
    const text = textOf(result.content);
    return text.length > 3_000 ? headTail(text, 2_000, 600) : undefined;
  }
};

function libraryCompactors(
  domain: "skill" | "material"
): Record<string, ToolCompactor> {
  return {
    [`read_${domain}_entry`]: readCompactor,
    [`create_${domain}_entry`]: mutationCompactor,
    [`edit_${domain}_entry`]: mutationCompactor,
    [`edit_${domain}_library_overview`]: mutationCompactor
  };
}

export const WORKSPACE_TOOL_COMPACTORS: Readonly<
  Record<string, ToolCompactor>
> = {
  read: readCompactor,
  search: searchCompactor,
  read_authoring_skill: readCompactor,
  edit: mutationCompactor,
  create: mutationCompactor,
  propose_continuity_commit: mutationCompactor,
  delete: deleteCompactor,
  load_skill: skillCompactor,
  query_linked_material_entries: materialCompactor,
  ask_user_question: keepCompactor,
  spawn_subagent: subagentCompactor,
  ...WEB_TOOL_COMPACTORS,
  ...libraryCompactors("skill"),
  ...libraryCompactors("material")
};

export function workspaceContextTask(input: AgentRunInput): ContextTaskKind {
  const context = input.workspaceContext;
  if (input.libraryAgentProfile && context?.libraryWorkspace) {
    return context.libraryWorkspace.domain === "skill"
      ? "library-skill"
      : "library-material";
  }
  if (context?.subagentAuthoring) return "subagent-authoring";
  if (input.academicAgentProfile && context?.academicWorkspace)
    return "academic";
  if (input.scriptAgentProfile && context?.scriptWorkspace) return "script";
  if (input.longAgentProfile && context?.longWorkspace) return "long";
  if (input.mysteryAgentProfile && context?.mysteryWorkspace) return "mystery";
  const short = context?.shortWorkspace;
  if (input.agentProfile && short) {
    if (short.activeStageId === "character_design") return "short-character";
    if (short.activeStageId === "draft") return "short-draft";
    return "short-plot";
  }
  return "general";
}

/**
 * The creation-space and library policy: prune tool output by kind, keep
 * user answers verbatim, and after a summary re-attach loaded skills plus,
 * while drafting, the end of the most recently written section.
 */
export function workspaceContextPolicy(
  input: AgentRunInput
): ContextPolicy | undefined {
  const settings = input.contextCompactionSettings;
  if (!settings) return undefined;
  const task = workspaceContextTask(input);
  return {
    settings,
    task,
    toolCompactors: WORKSPACE_TOOL_COMPACTORS,
    ...(input.conversationCheckpoint
      ? { checkpoint: input.conversationCheckpoint }
      : {}),
    ...(input.contextCompaction ? { manual: input.contextCompaction } : {}),
    rehydrate: (refs, budget) =>
      rehydrateWorkspaceContext(input, task, refs, budget)
  };
}
