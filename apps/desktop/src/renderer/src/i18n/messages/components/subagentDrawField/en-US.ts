export default {
  drawMode: "Draw mode",
  drawHint:
    "Runs each task several times in the background and hands only the selected result to the primary agent.",
  onlyAvailableInPureModes:
    "Pure modes only. Standard members have write tools, so repeated runs would edit the work again and again.",
  enabledHint:
    "Each delegation produces {arg0} results and hands back only the selected one, at about {arg0}× the usage.",
  enabledHintAuto:
    "Each delegation produces {arg0} results and the evaluator hands back the best one, at about {arg0}× the usage plus one evaluation.",
  enabledHintAutoCount:
    "The primary agent decides how many draws each delegation needs (up to {arg0}) from your request or the task, and states what each one should do differently. Only the selected one comes back; without such requirements the task runs once. Usage grows with the number of draws.",
  enabledHintAutoCountEvaluated:
    "The primary agent decides how many draws each delegation needs (up to {arg0}) from your request or the task, and states what each one should do differently. The evaluator hands back the best one; without such requirements the task runs once. Usage grows with the number of draws, plus one evaluation.",
  drawCount: "Draws",
  countValue: "{arg0} times",
  countAuto: "Auto (as needed, up to {arg0})",
  selection: "Selection",
  manual: "Manual",
  auto: "Automatic",
  manualHint: "When every draw is done, a picker card lets you choose.",
  autoHint:
    "When every draw is done, the evaluator picks one by its rules. If it can't, you choose instead.",
  evaluator: "Evaluator",
  evaluationMethod: "Evaluation method",
  llmEvaluation: "LLM evaluation",
  jevEvaluation: "JEV evaluation",
  selectJevModel: "Select a JEV model",
  noJevModelsConfigured:
    "No JEV model is configured yet. Add one under Custom models before enabling this.",
  jevModelHint:
    "Uses only configured JEV models for scoring. It never follows the primary agent or mixes in text-generation models.",
  evaluationRules: "Evaluation rules",
  restoreDefault: "Restore default",
  evaluatorBoundaryHint:
    "The evaluator sees only the task and the candidates, not the work, and is always required to submit its choice through the select tool.",
  jevEvaluatorBoundaryHint:
    "JEV evaluation sees only the task and candidate summaries, scores each candidate independently, picks the highest score, and falls back to manual selection on failure without switching to LLM evaluation.",
  jevRulesAppliedHint:
    "Extra rules are appended to the JEV score question instructions."
};
