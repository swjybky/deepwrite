import { loadDefaultStyleComparisonMethod } from "@deepwrite/contracts/renderer";

// The lazy feature waits for its prompt before creating a controller.
export const DEFAULT_STYLE_COMPARISON_METHOD =
  await loadDefaultStyleComparisonMethod();

export const PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD = [
  "请从措辞与用词、句式与节奏、叙述视角、描写与修辞、情绪与语气五个维度比较。",
  "关注表达习惯，不因题材、人物名或情节相同就判定文风相近。结合两份文本中的短句举证，概括最明显的共性与差异。",
  "各维度同等重要。样本较短或体裁差异较大时，在结论中说明判断依据的局限。"
].join("\n");
