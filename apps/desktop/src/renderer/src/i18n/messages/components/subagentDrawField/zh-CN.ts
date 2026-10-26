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
  evaluationRules: "评估规则",
  restoreDefault: "恢复默认",
  evaluatorBoundaryHint:
    "评估助手只看任务和候选，不读作品；系统会另外要求它必须调用选择工具提交结果。"
};
