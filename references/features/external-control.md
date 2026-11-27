# 外部控制（MCP）

验证日期：2026-11-23（测试实例）。验证 CLI 的 `app call` / `agent` / `data` 本身就走这条通道。截图：[外部智能体设置](../../test/2026-11-23-feature-map/settings-external-control.png)。

Antigravity 选项验证于 2026-11-24（测试实例）。截图：[复制接入配置](../../test/2026-11-24-antigravity-external-control/03-antigravity-config.png)、[Skill 安装入口](../../test/2026-11-24-antigravity-external-control/04-antigravity-skill.png)。

## 1. 功能说明

允许本机的外部智能体操作 DeepWrite。支持 Claude Code、Codex、DeepSeek Harness、ZCode、Kimi Code、Antigravity 等。

外部智能体通过 MCP 桥接进程连到 App 的控制端点，可以使用 25 个白名单工具：

- 读写作品和资料库
- 管理作品、文档、条目、团队
- 运行内置智能体并跟到结束、回答它的提问
- 从回收站恢复
- 重启软件（`restart_app`）：支持优雅保存后自动重连，也支持在卡死或明确允许打断任务时传 `force: true` 强启

桥接连接内置心跳保活（`externalControl.ping`）、空闲探活、断线安全重试（只读/幂等/未发包写入）与重启状态（`status: "restarting"`）跨实例衔接；主进程关闭后台渲染节流并在窗口关闭时自动拉起。

三条规则：

- 写入必须带版本号（`baseRevision`），不允许强制覆盖。
- 删除的内容进回收站，可以恢复。
- 作品被占用时返回 `external.busy`。

每个外部客户端第一次连接时需要用户批准。

## 2. 用户路径

1. 打开设置：头像菜单 →「设置」→「外部智能体」。
2. 打开「允许外部智能体操作软件」开关。
3. 在「接入方式」里选客户端标签页（Claude Code / Codex / …），复制或安装接入配置。
4. 在「操作指南 Skill」里给客户端安装 Skill。
5. 页面下方可以看到「已允许的智能体」「回收站」「最近操作」。

接入 Antigravity 时，在「接入方式」选「Antigravity」并复制配置，将 `deepwrite` 项合并进 `~/.gemini/config/mcp_config.json` 的 `mcpServers`。在「操作指南 Skill」点 Antigravity 对应的「安装」，即可将指南放到 `~/.gemini/config/skills/deepwrite/SKILL.md`。

## 3. 前后端对应

**Renderer**

- 设置面板：`extras/external-control/ExternalControlSettingsPanel.vue`
- 窗口侧的执行与跟踪：
  - `useExternalControlBridge.ts`（处理窗口请求，例如打开作品、运行智能体）
  - `tracked-run.ts`（把对话状态换算成 `get_agent_run` 的状态）
  - `tool-usage.ts`

**契约**

- `packages/contracts/src/external-control/`：
  - 工具清单 `tools.ts`
  - 工具参数 `read-tools.ts`、`write-tools.ts`、`run-tools.ts`
  - 通信协议 `protocol.ts`

**Main（extras）**

`extras/external-control/` 下的文件：

| 文件 | 职责 |
| --- | --- |
| `control-server.ts` | 控制端点（unix socket，Windows 上是命名管道） |
| `control-paths.ts` | 端点目录；开发版可以用 `DEEPWRITE_CONTROL_DIR` 改 |
| `client-approval.ts` | 客户端批准 |
| `tool-routes.ts` | 工具白名单与分发 |
| `*-tools.ts` | 各工具的实现 |
| `audit-log.ts` | 审计日志 |
| `trash-store.ts` | 回收站 |
| `bridge-entry.ts` | MCP 桥接进程，由外部客户端启动 |
| `skill/SKILL.md` | 给外部智能体的操作指南 |

**数据位置**

- 控制端点
  - 正式版：`~/.deepwrite/control/`
  - 开发版：`~/.deepwrite/control-dev/`
  - 测试实例：`~/.deepwrite-test/<环境>/control/`
- 客户端批准：`config/external-control.json`。`env seed` 会预先批准 `deepwrite-ctl`。
- 审计：`profile/logs/external-control.jsonl`，只记写入类工具，且只记 id。
- 回收站：`profile/external-trash/`。

## 4. 用验证 CLI 驱动

```bash
pnpm -s ctl app tools                                    # 25 个工具，取自契约源码
pnpm -s ctl app tools write_document                     # 单个工具的参数结构
pnpm -s ctl app tools restart_app                        # 重启工具的参数结构
pnpm -s ctl app call get_app_status
pnpm -s ctl app call list_works
pnpm -s ctl app call read_document --args '{"workId":"<id>","documentId":"<文档id>"}'
pnpm -s ctl app call write_document --args '{"workId":"<id>","documentId":"<文档id>","content":"……","baseRevision":"<read_document 返回的 revision>"}'
pnpm -s ctl app call list_trash
pnpm -s ctl logs tail --source external-control          # 审计记录
```

**拒绝路径**：用旧的 `baseRevision` 写入，应被拒绝，且原文不变。

```bash
pnpm -s ctl app call write_document --args '{"workId":"<id>","documentId":"<文档id>","content":"x","baseRevision":"v1:0:00000000"}'
# 退出码 1，error.details.code 为 external.stale_revision；审计日志记一条 result=external.stale_revision
```

## 5. 注意事项

- **改工具或错误码要同步 Skill。** 同步更新 `extras/external-control/skill/SKILL.md`，契约测试也要跟上（见 AGENTS.md）。
- **测试实例和开发版互不相通。** 测试实例只监听自己的端点；`deepwrite-dev` 这个 MCP 连的是开发版端点（`~/.deepwrite/control-dev/`）。
- **已知的对外状态问题（2026-11-23，已交给修复线程）：**
  - 学术写入冲突时，`get_agent_run` 仍报 `completed`，`changes` 里也照样列出文档。
  - 自动审批收尾时，会短暂报 `waiting_for_user`。
  - 长篇的 `read_document` 返回的 title 是文件路径。
- **控制接口不能改长篇和剧本杀的结构。** `manage_document` 只支持短篇、剧本、学术。
- **审计日志会自己截短。** 只保留最近 1000 条；`logs` 发现文件变短时会从头读，并在 `notes` 里注明。
