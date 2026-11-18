import type { WritingSearchMatch } from "@deepwrite/contracts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  academicTextResult,
  defineAcademicTool,
  syncAcademicSharedStateFromCore,
  type AcademicOverlayFile,
  type AcademicWorkspaceToolSharedState,
  type BuildAcademicWorkspaceToolsInput
} from "./shared";

interface FormattedAcademicMatch {
  documentId: string;
  kind: "foundation" | "reference_card" | "framework_stage" | "section";
  id: string;
  document?: "brief" | "body" | "state";
  title: string;
  citeKey?: string;
  chapterId?: string;
  snippet: string;
  matchCount: number;
}

function buildSnippet(
  text: string,
  needleLower: string
): {
  snippet: string;
  matchCount: number;
} | null {
  const lower = text.toLowerCase();
  let index = lower.indexOf(needleLower);
  if (index < 0) return null;
  const firstIndex = index;
  let matchCount = 0;
  while (index >= 0) {
    matchCount += 1;
    index = lower.indexOf(needleLower, index + Math.max(1, needleLower.length));
  }
  const start = Math.max(0, firstIndex - 50);
  const end = Math.min(text.length, firstIndex + needleLower.length + 90);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return {
    snippet: `${prefix}${text.slice(start, end).replace(/\s+/gu, " ").trim()}${suffix}`,
    matchCount
  };
}

function mapCoreSearchMatch(match: WritingSearchMatch): FormattedAcademicMatch {
  switch (match.kind) {
    case "thesis_overview":
    case "terminology":
      return {
        documentId: match.documentId,
        kind: "foundation",
        id: match.objectId,
        title: match.title,
        snippet: match.snippet,
        matchCount: match.matchCount
      };
    case "reference_card":
      return {
        documentId: match.documentId,
        kind: "reference_card",
        id: match.objectId,
        title: match.title,
        ...(match.citeKey ? { citeKey: match.citeKey } : {}),
        snippet: match.snippet,
        matchCount: match.matchCount
      };
    case "framework_stage":
      return {
        documentId: match.documentId,
        kind: "framework_stage",
        id: match.objectId,
        title: match.title,
        snippet: match.snippet,
        matchCount: match.matchCount
      };
    case "section_brief":
    case "section_body":
    case "section_state":
      return {
        documentId: match.documentId,
        kind: "section",
        id: match.objectId,
        document:
          match.kind === "section_brief"
            ? "brief"
            : match.kind === "section_state"
              ? "state"
              : "body",
        title: match.title,
        ...(match.chapterId ? { chapterId: match.chapterId } : {}),
        snippet: match.snippet,
        matchCount: match.matchCount
      };
    default:
      return {
        documentId: match.documentId,
        kind: "foundation",
        id: match.objectId,
        title: match.title,
        snippet: match.snippet,
        matchCount: match.matchCount
      };
  }
}

function collectOverlayMatches(
  state: AcademicWorkspaceToolSharedState,
  query: string,
  onlyDirtyOrInline: boolean
): FormattedAcademicMatch[] {
  const needle = query.toLowerCase();
  const results: FormattedAcademicMatch[] = [];
  const checkFile = (
    file: AcademicOverlayFile,
    meta: Omit<FormattedAcademicMatch, "documentId" | "snippet" | "matchCount">,
    searchableHeader = ""
  ): void => {
    if (onlyDirtyOrInline && !file.dirty) return;
    if (!file.loaded) return;
    const combined = searchableHeader
      ? `${searchableHeader}\n${file.content}`
      : file.content;
    const hit = buildSnippet(combined, needle);
    if (!hit) return;
    results.push({
      ...meta,
      documentId: file.id,
      snippet: hit.snippet,
      matchCount: hit.matchCount
    });
  };

  checkFile(state.thesisOverview, {
    kind: "foundation",
    id: state.thesisOverview.id,
    title: state.thesisOverview.title
  });
  checkFile(state.terminology, {
    kind: "foundation",
    id: state.terminology.id,
    title: state.terminology.title
  });

  for (const cardId of state.cardOrder) {
    const card = state.cards.get(cardId);
    if (!card) continue;
    checkFile(
      card.file,
      {
        kind: "reference_card",
        id: card.id,
        title: card.title,
        citeKey: card.citeKey
      },
      `${card.citeKey} ${card.title}`
    );
  }

  for (const stageId of state.frameworkStageOrder) {
    const stage = state.frameworkStages.get(stageId);
    if (!stage) continue;
    checkFile(
      stage.file,
      {
        kind: "framework_stage",
        id: stage.id,
        title: stage.title
      },
      stage.title
    );
  }

  for (const sectionId of state.sectionOrder) {
    const section = state.sections.get(sectionId);
    if (!section) continue;
    for (const docKind of ["brief", "body", "state"] as const) {
      checkFile(
        section[docKind],
        {
          kind: "section",
          id: section.id,
          document: docKind,
          title: section.title,
          ...(section.chapterId ? { chapterId: section.chapterId } : {})
        },
        docKind === "body" ? section.title : ""
      );
    }
  }
  return results;
}

export function buildAcademicSearchTool(
  input: BuildAcademicWorkspaceToolsInput,
  sharedState: AcademicWorkspaceToolSharedState
): AgentTool {
  const english = input.promptLocale === "en-US";
  return defineAcademicTool({
    name: "search",
    label: english ? "Search academic work" : "检索学术作品全文",
    description: english
      ? "Full-text search across foundation documents, reference cards (including citeKeys), framework stages, and manuscript sections (brief/body/state). Returns object kind, id, document, title, and snippet. Does NOT grant full-overwrite credentials."
      : "跨研究基石（研究立意、术语与符号表）、文献与证据卡（含 citeKey）、论证框架各阶段及正文各小节（brief/body/state）执行全文检索，返回命中对象的 kind、id、document、标题与上下文摘要。检索结果不授予全文覆盖凭证。",
    parameters: Type.Object({
      query: Type.String({
        description: english
          ? "Case-insensitive search keyword or phrase (1–300 characters)."
          : "检索关键词或短语（1–300 字，忽略大小写）。"
      }),
      limit: Type.Optional(
        Type.Integer({
          description: english
            ? "Maximum matches to return (1–100, default 20)."
            : "最多返回的命中条数（1–100，默认 20）。"
        })
      )
    }),
    execute: async (_toolCallId, params, signal) => {
      const query = String(params.query ?? "").trim();
      if (!query) {
        throw new Error(
          english
            ? "query: search query cannot be empty."
            : "query：检索词不能为空。"
        );
      }
      if (query.length > 300) {
        throw new Error(
          english
            ? `query: ${query.length} characters exceeds limit 300.`
            : `query：当前 ${query.length} 字，上限 300。`
        );
      }
      const limit = params.limit ?? 20;
      if (limit < 1 || limit > 100) {
        throw new Error(
          english
            ? "limit: must be between 1 and 100."
            : "limit：应在 1 到 100 之间。"
        );
      }

      await syncAcademicSharedStateFromCore(input, sharedState, signal);

      const dirtyDocIds = new Set<string>();
      const markIfDirty = (file: AcademicOverlayFile): void => {
        if (file.dirty) dirtyDocIds.add(file.id);
      };
      markIfDirty(sharedState.thesisOverview);
      markIfDirty(sharedState.terminology);
      for (const card of sharedState.cards.values()) markIfDirty(card.file);
      for (const stage of sharedState.frameworkStages.values())
        markIfDirty(stage.file);
      for (const section of sharedState.sections.values()) {
        markIfDirty(section.brief);
        markIfDirty(section.body);
        markIfDirty(section.state);
      }

      const activeDocIds = new Set<string>([
        sharedState.thesisOverview.id,
        sharedState.terminology.id,
        ...[...sharedState.cards.values()].map((card) => card.documentId),
        ...[...sharedState.frameworkStages.values()].map(
          (stage) => stage.file.id
        ),
        ...[...sharedState.sections.values()].flatMap((section) => [
          section.brief.id,
          section.body.id,
          section.state.id
        ])
      ]);

      let merged: FormattedAcademicMatch[];
      if (input.writingReader) {
        const coreResult = await input.writingReader.search(
          query,
          limit,
          signal
        );
        const fromCore = coreResult.matches
          .filter(
            (match) =>
              activeDocIds.has(match.documentId) &&
              !dirtyDocIds.has(match.documentId)
          )
          .map(mapCoreSearchMatch);
        const fromOverlay = collectOverlayMatches(sharedState, query, true);
        merged = [...fromOverlay, ...fromCore].slice(0, limit);
      } else {
        merged = collectOverlayMatches(sharedState, query, false).slice(
          0,
          limit
        );
      }

      if (merged.length === 0) {
        return academicTextResult(
          english
            ? `Search "${query}": 0 matches found.`
            : `检索「${query}」命中 0 条。`
        );
      }

      return academicTextResult(
        [
          english
            ? `Search "${query}": ${merged.length} matches (search snippets do NOT grant full-overwrite credentials):`
            : `检索「${query}」命中 ${merged.length} 条（检索摘要不授予全文覆盖凭证）：`,
          "",
          ...merged.map((item, idx) => {
            const attrs = [
              `kind=${item.kind}`,
              `id=${item.id}`,
              ...(item.document ? [`document=${item.document}`] : []),
              ...(item.citeKey ? [`citeKey=${item.citeKey}`] : []),
              ...(item.chapterId ? [`chapterId=${item.chapterId}`] : []),
              `matches=${item.matchCount}`
            ].join(", ");
            return `${idx + 1}. 【${item.title}】(${attrs})\n   ${item.snippet}`;
          })
        ].join("\n")
      );
    }
  });
}
