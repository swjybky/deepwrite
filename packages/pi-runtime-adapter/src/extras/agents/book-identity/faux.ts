import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type FauxResponseStep
} from "@earendil-works/pi-ai";
import {
  identityTaskField,
  type IdentityTask
} from "../../tools/book-identity-submit";
export function identityFaux(
  task: IdentityTask,
  runId: string
): FauxResponseStep[] {
  const field = identityTaskField(task);
  const candidates = Array.from(
    { length: task.input.candidateCount },
    (_, index) => {
      const ordinal = index + 1;
      if (field === "title")
        return {
          title: `长夜将明${ordinal}`,
          subtitle: "重新出发的故事",
          angle: `角度${ordinal}`,
          rationale: "依据作品处境设计的 Faux 候选。",
          keywords: ["希望", "选择"]
        };
      if (field === "synopsis")
        return {
          hook: `第${ordinal}次选择，改变一生。`,
          text: "主角面对新的处境与阻碍，必须作出自己的选择。命运的秘密尚待揭开。",
          angle: `悬念${ordinal}`,
          rationale: "Faux 验证简介候选。"
        };
      return {
        concept: `长夜孤灯${ordinal}`,
        scene: "夜色中的窗边，一盏灯照亮书页。",
        composition:
          task.agentId === "book-cover-design" &&
          task.input.titleRendering === "model"
            ? "主体位于下方，上方清晰排入书名并与画面协调。"
            : "主体位于下方，上方留白约三分之一。",
        palette: ["#1F2A44", "#C9A86A"],
        artStyle: "绘画",
        typography: "宋体",
        titlePlacement: "top",
        prompt:
          task.agentId === "book-cover-design" &&
          task.input.titleRendering === "model"
            ? `A complete illustrated book cover with a lamp beside a window at night. Render the exact title ${JSON.stringify(task.input.bookSnapshot.title)} in clear Song typeface lettering at the top, with high contrast and balanced spacing.`
            : "A lamp beside a window at night, no text, no letters, no logo, clean empty upper third, illustrated book cover",
        negativePrompt:
          task.agentId === "book-cover-design" &&
          task.input.titleRendering === "model"
            ? "watermark, logo"
            : "文字、水印",
        rationale: "Faux 验证封面方案。"
      };
    }
  );
  const book = task.input.bookSnapshot;
  const reads: FauxResponseStep[] =
    book.bookType === "long"
      ? [
          fauxAssistantMessage(
            fauxToolCall(
              "list",
              { stage: "plot", scope_id: "book_line" },
              { id: `${runId}-identity-list` }
            ),
            { stopReason: "toolUse" }
          ),
          fauxAssistantMessage(
            fauxToolCall(
              "read",
              { id: "book_line" },
              { id: `${runId}-identity-mainline` }
            ),
            { stopReason: "toolUse" }
          ),
          ...(book.navigation.volumes[0]
            ? [
                fauxAssistantMessage(
                  fauxToolCall(
                    "read",
                    { id: book.navigation.volumes[0].id },
                    { id: `${runId}-identity-volume` }
                  ),
                  { stopReason: "toolUse" }
                )
              ]
            : [])
        ]
      : [
          fauxAssistantMessage(
            fauxToolCall(
              "list_workspace_content",
              {},
              { id: `${runId}-identity-list` }
            ),
            { stopReason: "toolUse" }
          ),
          ...(book.documents[0]
            ? [
                fauxAssistantMessage(
                  fauxToolCall(
                    "read_workspace_content",
                    { document_id: book.documents[0].id },
                    { id: `${runId}-identity-read` }
                  ),
                  { stopReason: "toolUse" }
                )
              ]
            : []),
          ...("draft" in book && book.draft.sections[0]
            ? [
                fauxAssistantMessage(
                  fauxToolCall(
                    "read_draft_sections",
                    { section_id: book.draft.sections[0].id, file: "body" },
                    { id: `${runId}-identity-opening` }
                  ),
                  { stopReason: "toolUse" }
                )
              ]
            : [])
        ];
  return [
    ...reads,
    fauxAssistantMessage(
      fauxToolCall(
        "submit_book_identity_candidates",
        { candidates },
        { id: `${runId}-identity-submit` }
      ),
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage(fauxText("设计候选已保存。"))
  ];
}
