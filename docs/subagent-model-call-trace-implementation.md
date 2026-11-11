# 子智能体调用追踪实施报告

## 当前可用能力

已接入预设子智能体及抽签评估助手的实际 stream 调用边界，记录客户端请求 provider/model、本地请求 ID、调用序号、时间、耗时和结果状态。会话 → 子智能体运行详情 → 模型调用记录，可查看并导出当前详情中的脱敏 JSON。导出使用字段白名单，不含任务正文、提示词和认证信息。

Main 接收 `subagent.activity` 后通过 `subagent-call-journal.ts` 独立追加并 fsync 到 `<当前配置目录>/diagnostics/subagent-model-calls.jsonl`；不依赖 Renderer 保存。最多保留当前文件及 `.1`、`.2`，单段轮转阈值 10 MiB。记录包含 session/run/parentToolCall/subagentRun/subagent 标识，可通过本地文件核对。按文件从旧到新读取，同一本地 requestId 的开始和结束对应一次调用；仅有开始表示结果未知。旧记录会随容量轮转删除，此诊断记录不随单个会话删除自动删除。写入失败会输出 Main 错误日志，不伪装保存成功。

这是 Main 拥有的诊断元数据，与已有 Main 模型用量记录一致，不写作品或 Core 的会话数据库。原先拟议的 Core 专用日志链路未实现，采用独立诊断日志满足执行期间保存信息的核心需求。硬退出后文件中的记录可读；尚未将独立日志自动导入会话详情，因此崩溃前未被 Renderer 保存的记录应从诊断文件查看。界面导出仅含已加载详情。

本轮验证：调用采集和真实临时目录写入/轮转/字段剔除测试共 4 项通过；完整类型检查通过；新增文件及详情组件 ESLint、Renderer boundary、国际化、生产构建与 Renderer 构建检查通过。尚未运行真实供应商调用或桌面交互验收，下载按钮的实际桌面行为尚未实测。

观测边界：请求模型来自实际调用参数；SDK 未提供可靠的原始响应模型证据时明确未知。本地 requestId 不是供应商请求 ID，调用序号不是重试次数。专用授权查询 API、配置版本快照、重试关联和 usage 尚未补齐；本次不宣称实现完整审计系统或证明供应商底层模型。

以下为前两轮实施历史，所述缺口以本节为准。

本次在现有目录增量修改，保留原有改动，没有修改 API 仓库、启动代理、推送或部署。

已实现：预设子智能体 Agent streamFn 调用边界产生开始与结束 activity，经 contracts 传递至现有子智能体运行详情。每条有本地 requestId、调用序号、客户端请求 provider/model、开始结束时间、耗时及完成/错误/取消状态。activity 外层沿用 sessionId、runId、parentToolCallId、subagentRunId、subagentId。异常抛出及没有终止事件的流通过现有观察器规范化。响应模型明确为 unknown，不使用 SDK 规范化的 model 字段冒充原始响应证据。

查看入口：运行会话 → 子智能体运行详情 → 模型调用记录。仅新执行且经过 subagent-child 的调用有记录；当前 JSON 展示仍需产品化和国际化。

验证：新增合成流行为测试 3 项通过，覆盖成功、抛错、取消及响应模型未知，检查错误正文和 SDK 配置名未进入追踪。Renderer boundary 检查通过。全项目类型检查发现新增测试缺少 SDK TranscriptContext 品牌类型，已修正测试夹具；修正后尚未重跑，不计为通过。

尚未完成：Core 增量持久化及异常退出恢复、历史详情恢复、脱敏文件导出、外部控制查询、保留期限与清理、配置模型与预设版本快照、网关 request ID 贯通、原始响应元数据及 token 来源、重试与切换原因、抽签评审独立入口覆盖。当前 requestId 仅为客户端本地关联 ID，未发送至供应商，sequence 是调用序号而非重试序号。不能把此实现视为用户要求的独立可交付持久化能力。

测试使用模拟流，没有真实供应商调用，没有双预设实际运行或桌面视觉验收，不能证明供应商底层权重。开始 activity 目前不保证落盘，因此异常退出后的审计能力未交付。

## 本轮增量实现与验证

保留已有差异，未修改 API 仓库，未创建 checkout、委派、推送或部署。

本轮修改：`packages/pi-runtime-adapter/src/subagent-draw-evaluator.ts` 接入评估助手实际 stream 调用；`packages/contracts/src/session/subagent.ts` 增加 interrupted 状态；`apps/desktop/src/utilities/conversation-storage/runtime-recovery.ts` 在新 Main 接管时恢复已落盘的调用，未终结者标为 interrupted，不捏造结束时间；同目录 `runtime-recovery.test.ts` 验证 SQLite 持久数据被新实例恢复。`SubagentRunDetail.vue` 及 `i18n/messages/components/subagentRunList/{zh-CN,en-US}.ts` 用可读字段替代 JSON，支持中英文、主题变量和长编号换行。

查看入口仍为会话的子智能体运行详情。记录沿用会话 SQLite 的 subagentRuns.modelCalls 详情存储与会话保留行为，没有独立日志清理策略。恢复测试使用真实临时 SQLite 文件、多个数据库实例和 Main 身份切换；没有模拟供应商实测。

本轮已通过：模型调用测试 3 项、磁盘恢复测试 1 项；Renderer boundary；i18n；生产构建及 Renderer 构建体积检查。完整 `pnpm typecheck` 已结束，退出码 0，通过 Renderer、Desktop Node、contracts、shared 和 pi-runtime-adapter 类型检查。

仍有明确缺口：尚未建立 Main 到 Core 的独立增量调用记录写入确认，因此 Renderer 保存前崩溃仍会丢失记录；未完成专用脱敏导出与 external control 查询、配置快照、实际重试关联及可观测 usage。不能将本轮变更描述为已交付完整审计功能。上游响应模型、网关 request ID、底层权重均未知；本地 requestId 不代表供应商请求编号。未进行真实供应商验证或桌面视觉验收。本轮没有发现或证实阻止剩余实现的外部障碍。
