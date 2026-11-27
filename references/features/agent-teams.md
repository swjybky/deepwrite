# 智能体团队

验证日期：2026-11-23（测试实例，CLI 驱动）。截图：[团队列表](../../test/2026-11-23-feature-map/agent-teams.png)、[团队详情](../../test/2026-11-23-feature-map/agent-team-detail.png)。

## 1. 功能说明

团队由一个主智能体和若干子智能体组成。

- **默认团队**：每种作品类型各有一个默认团队（短篇、剧本、长篇、学术、剧本杀），出厂都是停用状态。
  - 长篇默认 3 个子智能体：章节写手、连续性记录员、一致性审校。
  - 学术默认 5 个，剧本杀默认 4 个。
- **内置团队（只读）**：长篇类型另内置「基础长篇默认团队」（9 个预设子智能体，带「内置」标签），支持启用、绑定作品和只读查看所有子智能体指令与设置，但不支持直接改名、修改或删除；可在列表行或详情页点击「复制」/「复制以自定义」生成可编辑的用户副本。
- **启用后**：作品的「运行模式」可以选团队。主智能体会用 `spawn_subagent` 委派子智能体。可以打开「并行运行子智能体」，最多同时 5 个。
- **子智能体设置**：每个子智能体可以单独设
  - 模型（默认跟随主智能体）
  - 模式：常规 / 纯净只读 / 纯净无工具
  - 抽卡
  - 指令
- **团队来源**：可以导入 JSON 或 ZIP 团队包，也可以从团队广场安装。
- **作品绑定**：团队可以绑定到作品，入口是作品「…」→「绑定」→「团队」页签。

## 2. 用户路径

1. 在左侧栏点「智能体团队」，右侧出现团队列表。
   - 列表上方的按钮可以导入团队包、新建团队。
   - 可以按类型筛选：全部、短篇、剧本、长篇、学术写作、剧本杀。
2. 每个团队行有一个启用开关，以及下载、重命名、删除按钮。
3. 点团队名进入详情页，可以：
   - 开关启用、开关并行运行；
   - 从技能库加载子智能体，或新增子智能体；
   - 逐个编辑、复制、删除子智能体，调整它的启用状态。
4. 改完后点「保存智能体团队」。

## 3. 前后端对应

**Renderer**

- 列表：`components/AgentTeamCatalogFeature.vue`、`AgentTeamCatalogList.vue`、`AgentTeamCatalogDialogs.vue`
- 详情：`AgentTeamSettingsPanel.vue`、`AgentTeamSubagentSection.vue`、`AgentTeamSubagentEditor.vue`、`AgentTeamSubagentCard.vue`、`AgentTeamParallelSwitch.vue`、`AgentTeamSaveBar.vue`
- 作品绑定：`BookAgentTeamBindings.vue`
- 运行模式选择：`AgentTeamModeSelect.vue`

**Preload**

- `preload/agent-teams-api.ts`：`agentTeams.list`、`create`、`rename`、`delete`、`setEnabled`、`setBookBinding`、`save`、`download`、`install`、`exportPackage` 等

**Main**

- 命令入口：`main/ipc/agent-team-commands.ts`
- 配置存取：`main/agent-team-config-store.ts`
- 作品绑定文件：`agent-team-book-binding-file.ts`
- 运行模式：`agent-team-run-mode.ts`
- 团队包：`agent-team-package-service.ts`
- 内置管理工具：`team-management-bridge.ts`

**智能体**

- `packages/pi-runtime-adapter/src/subagent-*.ts`：派遣、调度、写锁、抽卡、超时等
- `team-management-runtime.ts`

**磁盘数据**

- 团队配置：`profile/config/agent-team-profiles.json`
- 作品与团队的绑定：存在本机配置里，**不进**作品的 `deepwrite.json`
- 子智能体的模型调用记录：`profile/diagnostics/subagent-model-calls.jsonl`，可以用 `pnpm -s ctl logs tail --source model-calls` 查看

## 4. 用验证 CLI 驱动

**界面：查看团队**

```bash
pnpm -s ctl ui click --role button --name 智能体团队
pnpm -s ctl ui click --text 默认长篇团队 --nth 0                 # 进入详情；团队行的可访问名称是拼接文字，用 --text
pnpm -s ctl ui screenshot --out test/<日期-主题>/team-detail.png
pnpm -s ctl ui click --label 返回团队列表
```

**接口：读写团队**

```bash
pnpm -s ctl app call list_agent_teams                           # 5 个默认团队，均 enabled=false
pnpm -s ctl app tools save_agent_team                           # 写团队前先看参数结构
pnpm -s ctl app call manage_agent_team --args '{"action":"enable","teamId":"<id>"}'
```

**团队模式运行**

```bash
pnpm -s ctl agent run --work <作品id> --new --mode team --message "……"
pnpm -s ctl agent trace <runId>                                 # 看 spawn_subagent 和子工具轨迹
pnpm -s ctl logs tail --source model-calls --since <标记>        # 子智能体每次模型调用的状态与耗时
```

## 5. 注意事项

- **团队模式的前提。** 作品类型要有一个已启用的团队，否则 `--mode team` 会失败。不写 `--mode` 时，有团队就用团队，没有就用主智能体。
- **启用和停用会改测试配置。** 只在测试环境里切换，验证完恢复原状。
- **团队行定位。** 团队行按钮的可访问名称是拼接文字（如「默认长篇团队 长篇 3 个子智能体 并行已关闭」），`--role button --name` 很难写准，用 `--text 团队名 --nth 0`。
- **热更新可能让页面变空白。** 2026-11-23 出现过：同一工作区的另一个会话改了 `WorkspaceShell.vue`，热更新后本页空白，日志里没有报错。先 `pnpm -s ctl ui reload`；改的是 Main 或 Utility 时用 `env restart`。
- **团队运行更贵。** 用量是单智能体的几倍；子智能体的失败要看 `model-calls` 日志和 `agent trace` 里子工具的结果。
