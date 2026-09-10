import type { LongToolContext } from "./context";
import { buildAskUserQuestionTool as buildQuestion } from "../ask-user-question-tool";
export function buildAskUserQuestionTool(ctx: LongToolContext) {
  return buildQuestion(ctx.input.requestUserInput);
}
