# 创作空间智能体写作

验证日期：2026-11-24。使用测试实例和真实模型：小站 Deepseek-v4.1-flash。
截图：[界面发消息后的结果](../../test/2026-11-23-feature-map/agent-ui-run.png)。
场景报告：[五类场景](../../test/2026-11-23-verify-cli-p4/README.md)。

## 1. 功能说明

在打开的作品里，给主智能体（或绑定的智能体团队）发一条消息。智能体用工具做三件事：
- 读作品目录和文档：`read`、`list`、`search`；
- 改文档：`edit`、`write`、`create`、`delete`；
- 按需查素材、加载技能、向用户提问。

每次改动都先形成**提案**，再按「正文修改权限」处理：
- 「替我审批」：自动批准并保存；
- 需要审批的模式：先出提案卡，等用户接受。

运行结束后，对话末尾有一张「修改了 N 个文件」汇总卡，列出每份文档的增删行和保存状态。

五类作品（短篇、剧本、长篇、学术、剧本杀）共用同一个内核（`packages/pi-runtime-adapter/src/kernel/`），各自的工具和提示词不同。

## 2. 用户路径

1. 左侧栏「创作空间」，点开一部作品。中间是对话区，右侧是文档编辑区。
2. 对话区底部输入框：
   - 占位文字「随心输入，输入 / 调用技能，输入 @ 引用素材……」；
   - 无障碍名称「智能体消息」。
3. 输入框下方一排控件：
   - 点模型配置按钮（如 `Deepseek-v4.1-flash · 深度`，控件名「模型配置」）打开三栏配置面板：
     - 左栏按收藏、全部与模型来源切换，中栏支持搜索模型与星标收藏，右栏直接选择思考等级（或温度）与联网开关；
     - 面板底栏包含运行模式「普通模式」或团队模式（控件名「选择智能体运行模式」，作品绑定了团队才有意义）与正文修改权限「替我审批」等（控件名「选择正文修改权限」）。
4. 点「发送消息」（或回车）。对话区会依次出现：
   - 思考过程与工具调用；
   - 回复；
   - 「修改了 N 个文件」汇总卡。
5. 顶部的「历史对话」「新建对话」用来切换和新开会话。

## 3. 前后端对应

**Renderer**

- 对话区：
  - `components/AgentConversation.vue`
  - `ConversationComposer.vue`（输入框）
  - `ConversationMessageList.vue`
  - `ConversationFileChangeSummary.vue`（汇总卡）
  - `AgentEditProposalCard.vue`（提案卡）
- 发送与会话：
  - `composables/useAgentConversation.ts`
  - `composables/agent-conversation/send-transport.ts`（发出 `session.prompt`）
  - `run-lifecycle.ts`、`streaming.ts`、`tool-events.ts`（处理事件流）
- 提案落盘：
  - `composables/useProposalCoordinator.ts`，调用 `catalog.saveDocument`、`createDraftSections`、`saveLibraryEntry` 等
  - 按作品类型分 lane，在 `composables/proposal-coordinator/` 下：学术是 `academic-proposal-lane.ts`，长篇是 `long-*`；短篇小节的提案仍写在 `useProposalCoordinator.ts` 里
  - 冲突判定：`stale-base.ts`

**Preload**

- `preload/session-models-api.ts`：发 `session.prompt`
- `preload/index.ts`：发 `catalog.saveDocument` 等

**Main**

- `main/ipc/session-commands.ts`：处理 `session.prompt`，按会话加占用锁（同一会话不能并发运行，否则返回 `agent.session_busy`），转给 Agent Utility。
- 模型密钥只在 Main 和 Agent 之间传递。

**Agent Utility 与内核**

- `utilities/agent-entry.ts`、`agent-run-registry.ts`
- 内核 `packages/pi-runtime-adapter/src/kernel/`：
  - `run-kernel.ts`、`run-agent.ts`
  - `write-approval-gate.ts`（审批闸门）
- 各类作品的工具装配：`packages/pi-runtime-adapter/src/run-tools.ts`，以及 `short-agent-tools/`、`academic-agent-tools/` 等
- 提示词：`prompts-*.ts`

**Core Utility**

- 读：经 Main 授权的只读桥读作品。
- 写：接受提案后由 Core 落盘到 `workspace/books/<书名>/stages/...`，并处理版本冲突。

**对话存储**

- 位置：`profile/renderer-state/conversations.sqlite`，由 conversation-storage worker 写入。
- 表：`scopes`、`sessions`、`messages`、`nodes`、`chunks`。
- 作用域键：`conversation-history:<作品id>%3Achat`。
- 工具参数与结果、提案状态都存在消息的 details 里：`toolCalls`、`editProposals`。

**相关设置**

- 测试配置 `profile/config/general-settings.json` 的 `permissionMode`。`env seed` 设为 `auto-approve`，也就是「替我审批」。
- 默认模型：`profile/config/models.json` 的 `defaultModelId`。

## 4. 用验证 CLI 驱动

**界面路径**：和用户一样在输入框发消息。

```bash
pnpm -s ctl ui open --work <作品id>
pnpm -s ctl logs mark --name before-agent
pnpm -s ctl ui fill --label 智能体消息 --value "先读取「剧情设计」，再在「第一节 · 正文」写两句开场。末尾另起一行写 FM-UI-01。"
pnpm -s ctl ui click --label 发送消息
pnpm -s ctl ui wait --label 停止生成 --gone --timeout 300   # 生成中发送按钮变成「停止生成」
pnpm -s ctl app call get_app_status                        # activeRunCount 应为 0
pnpm -s ctl agent trace --work <作品id>          # 模型、用量、每次工具调用与提案状态
pnpm -s ctl ui screenshot --out test/<日期-主题>/agent-run.png
```

**接口路径**：要 runId、要断言时用。它和界面发消息走同一条路，窗口里能看到对话。

```bash
pnpm -s ctl agent run --work <作品id> --new --mode normal --message "……末尾另起一行写 DW-1234。"
pnpm -s ctl agent assert <runId> --tools "read,edit|write" --doc "第一节 · 正文=DW-1234" --saved --logs-since before-agent
pnpm -s ctl agent trace <runId> --full            # 查参数、结果、哪一步失败
```

**回归**：五类作品各跑一个预置场景。每个场景用唯一校验词，并检查提案全部保存。

```bash
pnpm -s ctl agent scenario all --out-dir test/<日期-主题>/scenarios
pnpm -s ctl check report --dir test/<日期-主题>
```

清理场景建的作品：`pnpm -s ctl data clear --loaded`。

## 5. 注意事项

- **不要只看运行状态和回复。** 2026-11-23 的学术场景里出现过这样的情况：
  - 写入工具回「已提交自动保存」；
  - `get_agent_run` 报 `completed`，`changes` 也列出了文档；
  - 但两份提案都停在 `conflict`，文档实际为空，日志无报错。
  这个问题尚未修复。验证写入一律加 `agent assert --saved`，并回读文档。
- **模型可能自称做了、实际没做。** 例如长篇场景里，模型说两份都写了校验词，但正文那次写入参数里没有。断言要按文档内容判断，不按回复判断。
- **模型可能先猜错 id 再纠正。** 剧本场景里，模型用不存在的剧集 id 读取，失败两次后才查目录。`noFailedTools` 会判失败，这是有意的：说明工具描述或目录提示不够。
- **`waiting_for_user` 可能是暂态。** 自动审批下，运行收尾时会短暂出现这个状态。`agent wait` 要它持续 20 秒才算真的在等用户。
- **同一会话不能并发。** 上一次没结束时再发消息，Main 返回 `agent.session_busy`。作品正被运行占用时，控制接口的写入工具返回 `external.busy`。
- **剧情结构是共享的。** 短篇和剧本的剧情结构（阶段）由所有作品共用。改结构的运行会停在 `waiting_for_input` 等确认，除非任务本来就要改结构，否则不要自动同意。
- **用量。** 默认模型是官方小站，不设次数上限。一次短任务约 1 万 token，五类场景合计约 5 分钟。
- **模型调用日志只覆盖子智能体。** `logs` 的 `model-calls` 来源只记子智能体。主智能体的模型与用量看 `agent trace` 的 `model`、`usage`。
