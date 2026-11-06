export default {
  drawMode: "抽卡模式",
  drawHint: "收到任务后在后台独立运行多次，只把选中的一份交回主智能体。",
  onlyAvailableInPureModes:
    "仅纯净模式可用：常规成员带写入工具，多次运行会重复修改作品。",
  enabledHint:
    "每次委派生成 {arg0} 份结果，只把选中的一份交回主智能体，消耗约为 {arg0} 倍。",
  enabledHintAuto:
    "每次委派生成 {arg0} 份结果，由评估助手选出一份交回主智能体，消耗约为 {arg0} 倍，另加一次评估。",
  enabledHintAutoCount:
    "主智能体按你的要求或任务需要决定每次抽几份（最多 {arg0} 份），并为每份写明差异要求，只把选中的一份交回主智能体；不需要多个版本时只运行一次。消耗随份数增加。",
  enabledHintAutoCountEvaluated:
    "主智能体按你的要求或任务需要决定每次抽几份（最多 {arg0} 份），并为每份写明差异要求，由评估助手选出一份交回主智能体；不需要多个版本时只运行一次。消耗随份数增加，另加一次评估。",
  drawCount: "抽卡次数",
  countValue: "{arg0} 次",
  countAuto: "自动（按需，最多 {arg0} 份）",
  selection: "选择方式",
  manual: "手动",
  auto: "自动",
  manualHint: "全部候选完成后弹出选择卡，由你挑选。",
  autoHint:
    "全部候选完成后由评估助手按规则选择；它没能完成选择时改为由你手动选择。",
  evaluator: "评估助手",
  evaluationMethod: "评估方式",
  llmEvaluation: "大模型评估",
  jevEvaluation: "JEV 模型评估",
  selectJevModel: "选择 JEV 模型",
  noJevModelsConfigured:
    "尚未配置 JEV 模型。请先在「自定义模型」中添加 JEV 模型后再启用。",
  jevModelHint:
    "仅使用已配置的 JEV 模型独立打分，不会跟随主智能体，也不会混用大模型。",
  evaluationRules: "评估规则",
  restoreDefault: "恢复默认",
  evaluatorBoundaryHint:
    "评估助手只看任务和候选，不读作品；系统会另外要求它必须调用选择工具提交结果。",
  jevEvaluatorBoundaryHint:
    "JEV 评估只看任务和候选摘要，不读作品；对每份候选独立打分后取最高分提交选择，失败时改为手动选择且不会回退大模型评估。",
  jevRulesAppliedHint: "补充规则会写入 JEV 评分问题的 instructions。"
};
