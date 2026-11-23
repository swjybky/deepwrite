# 创作空间 MCP 冒烟验收

## 目标与成功标准

五类合成作品均能发起普通模式智能体，调用对应工具并保存预期产物。用 MCP 回读、全文搜索与版本检查验证结果。

## 环境

- macOS，DeepWrite 1.9.0，`pnpm dev`。项目 `deepwrite-dev` 已连接指定开发桥，复用现有配置。
- 使用开发版已配置的模型，运行模式 `normal`。MCP 运行结果不提供具体模型 ID。合成批次为 `261121075536`。

## 步骤与命令

- 用 `get_app_status` 和 `list_works` 核对连接，以 `manage_work` 创建作品，用 `get_work`、`read_document` 和 `write_document` 准备样本。用 `run_agent` 和 `get_agent_run` 跟踪运行，以 `read_document` 和 `search_text` 查验产物。剧本杀另调用 `open_in_app` 和 `stop_agent_run`。
- 用 `manage_document`、`write_document`、`list_trash` 和 `restore_trash_item` 验证学术合成小节的版本保护与恢复。

## 结果

[HTML 结果](2026-11-21-creation-workspace-mcp/index.html)列出上一轮有实测证据的工具和待补用例。

| 类型 | 智能体工具成功次数 | 实际产物 |
| --- | --- | --- |
| 短篇 | `read` 5、`edit` 2 | 第一节正文与状态回读通过 |
| 剧本 | `read` 5、`edit` 2 | 第一集场景、动作、对白和本集状态回读通过 |
| 长篇 | `list` 1、`read` 3、`edit` 2、`create` 1 | 第一章正文和章卡回读通过，目录新增「换班签名」 |
| 剧本杀 | `read` 4、`edit` 2、`search` 1 | 玩家线索及主持手册回读通过，玩家可见检索只命中搜证线索 |
| 学术 | `read` 5、`edit` 3 | 方法指引及正文回读通过，含待补数据。沿用会话补齐指引末行校验词 |

- 剧本杀从设置页发起时返回 `external.not_ready`，返回应用后可发起。同一轮的两次写入中，玩家线索已保存，主持手册写入失败，随后连续三次读取失败。停止该轮后沿用会话单独写手册，已保存并回读。
- 学术专用小节旧版本写入返回 `external.stale_revision`，原文保留。运行期间恢复返回 `external.busy`，停止运行后恢复成功，指引、正文、节末状态齐全，正文原样保留。
- 智能体工具共 40 次，成功 36 次，失败 4 次，归一化 0 次。十个目标文档均命中合成校验词，短篇和剧本的共享剧情结构一致。

## 未覆盖与后续

- 本轮覆盖普通模式及作品工具，未验团队模式、联网搜索、素材与技能绑定。五份合成作品留在创作空间供复查。
