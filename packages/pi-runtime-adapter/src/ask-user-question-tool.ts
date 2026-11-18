import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type, type Static } from "@earendil-works/pi-ai";
import {
  AgentUserInputQuestionsSchema,
  type PromptLocale
} from "@deepwrite/contracts";
import { piStrictToolSampling } from "./pi-tool-schema";
import type { AgentUserInputRequester } from "./runtime-types";
const strictObject: typeof Type.Object = (properties, options) =>
  Type.Object(properties, { ...options, additionalProperties: false });

const optionParameter = strictObject({
  id: Type.String({
    minLength: 1,
    maxLength: 80,
    description: "Stable option id echoed in the user's answer."
  }),
  label: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 500 }))
});

const questionParameter = strictObject({
  id: Type.String({
    minLength: 1,
    maxLength: 80,
    description: "Stable question id echoed in the user's answer."
  }),
  question: Type.String({ minLength: 1, maxLength: 1_000 }),
  header: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  options: Type.Optional(
    Type.Array(optionParameter, { minItems: 2, maxItems: 5 })
  ),
  selection_mode: Type.Optional(
    StringEnum(["single", "multiple"], {
      description: "Choice selection: single (default) or multiple."
    })
  )
});

export function buildAskUserQuestionTool(
  requestUserInput?: AgentUserInputRequester,
  locale?: PromptLocale
): AgentTool {
  const parameters = strictObject({
    questions: Type.Array(questionParameter, { minItems: 1, maxItems: 3 })
  });
  return {
    name: "ask_user_question",
    label: locale === "en-US" ? "Ask the user" : "询问用户",
    description:
      locale === "en-US"
        ? "Ask only for essential choices or missing facts. Use 1–3 questions with stable question and option ids. The client adds a free-text option. Put any recommended option first and mark it (Recommended). Do not duplicate write approval."
        : "仅在继续执行确实缺少用户确认、选择或关键信息时提问。除非确有必要或用户明确要求，否则不要频繁向用户提问。一次可提 1 到 3 个简短问题；问题和选项必须带稳定 id。客户端会为每个选择题自动追加“输入自己的回答”，不要自行创建其他或自定义选项。若推荐某一选项，将它放在首位并在 label 后加“(Recommended)”。上下文足够时应直接行动，不要用它重复确认普通写入审批。",
    parameters,
    ...piStrictToolSampling(parameters),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      if (!requestUserInput) {
        throw new Error(
          locale === "en-US"
            ? "This run cannot ask the user."
            : "当前运行无法向用户提问。"
        );
      }
      const questions = AgentUserInputQuestionsSchema.parse(
        (params as Static<typeof parameters>).questions.map(
          ({ selection_mode, ...question }) => ({
            ...question,
            ...(selection_mode === undefined
              ? {}
              : { multi_select: selection_mode === "multiple" })
          })
        )
      );
      const response = await requestUserInput(
        { toolCallId, source: "ask_user_question", questions },
        signal
      );
      return {
        content: [
          {
            type: "text",
            text:
              locale === "en-US"
                ? `User response:\n${JSON.stringify({ answers: response.answers }, null, 2)}\nIf essential information was skipped, stop the dependent action.`
                : `用户已回答：\n${JSON.stringify({ answers: response.answers }, null, 2)}\n若用户跳过且关键信息仍不足，请停止依赖该信息的操作，不得猜测。`
          }
        ],
        details: { kind: "none" }
      };
    }
  };
}
