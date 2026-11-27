# 功能地图

每个功能一页：做什么、用户怎么走到、前后端在哪、怎么用验证 CLI 驱动、哪里容易出错。改功能前先读对应页，改完按页里的命令验证；页里写的路径或命令和代码对不上时，以代码为准并顺手更新这一页。

驱动命令都来自验证 CLI（`pnpm -s ctl`，命令说明见 `pnpm -s ctl help`），只操作隔离的测试实例 `~/.deepwrite-test/default/`。开始前：

```bash
pnpm -s ctl env doctor          # 不健康时按 nextSteps 执行（通常是 env start 或 env restart）
pnpm -s ctl data load short,long,libraries   # 需要现成作品和资料库时
pnpm -s ctl ui reload            # 页面空白或状态错乱时（多半是热更新造成的）
```

同一工作区里有别的会话在改代码时，测试实例会跟着热更新。看到和本页描述对不上的界面，先 `ui reload` 再判断；需要稳定环境时用独立的 git worktree。

改了功能的入口、组件路径、命令名或工具名，同步更新对应页面，并运行 `pnpm -s ctl check features`。它会机械检查页面里的代码路径、链接、CLI 命令和参数、IPC 命令名、工具名是否还存在；`check changed` 在相关代码或地图改动时也会自动跑它。

## 功能清单

| 功能 | 一句话 | 详情 |
| --- | --- | --- |
| 新建书籍 | 从左侧栏「新建书籍」建短篇、剧本、长篇、学术或剧本杀作品，落成工作目录下的作品文件夹 | [new-book.md](new-book.md) |
| 创作空间智能体写作 | 在作品里给智能体发消息，智能体用读写工具改文档，提案按审批模式保存 | [workspace-agent.md](workspace-agent.md) |
| 长篇工作台 | 世界观、人物、剧情、分卷章节与连续性账本，按章写作与连续性提交 | [long-workspace.md](long-workspace.md) |
| 剧本杀 | 真相统筹、角色、分幕人物本、线索与主持人手册，信息分流防泄露 | [mystery.md](mystery.md) |
| 学术写作 | 研究底座、论证框架、按节三联正文与证据卡，不虚构数据 | [academic.md](academic.md) |
| 素材库与技能库 | 建资料库、加条目，绑定到作品后智能体可查素材、加载技能 | [libraries.md](libraries.md) |
| 智能体团队 | 主智能体加子智能体，按作品类型启用，可并行、可绑定到作品 | [agent-teams.md](agent-teams.md) |
| 设置与模型配置 | 审批模式、外观、联网、外部智能体，以及免费、官方小站、自定义模型 | [settings-models.md](settings-models.md) |
| 导出 | 正文导出为 DOCX、TXT、EPUB、Markdown，剧本杀资料包，资料库 ZIP | [export.md](export.md) |
| 双端同步 | 经自己的 WebDAV 网盘与手机端接续写作 | [device-sync.md](device-sync.md) |
| 外部控制（MCP） | 外部智能体经控制端点使用 25 个白名单工具操作 App | [external-control.md](external-control.md) |
| 更多功能 | 聊天助手、资源广场、拆书分析等扩展智能体与工具页，以及默认隐藏的扩展功能 | [more-features.md](more-features.md) |

尚未单独成页：剧本作品（与短篇共用一套代码，差异写在 [new-book.md](new-book.md) 和 [workspace-agent.md](workspace-agent.md) 里）、整书拆解、长篇转素材库、书名·简介·封面、云端备份、版本历史、语音与图片模型。

## 写法约定

- 文件名用英文短横线，标题用界面上的中文名。
- 五节固定：功能说明、用户路径、前后端对应、用验证 CLI 驱动、注意事项。
- 界面没有 URL 路由（地址始终是 `/`），“路由”写成左侧栏位置与窗口状态。
- 前后端对应按调用链写：Renderer 组件 → Preload 的 `window.deepwrite.*` → 契约命令 → Main 路由 → Utility → 磁盘数据。
- CLI 命令必须实际跑通过再写进来，并注明验证日期；界面定位优先用 `--role` + `--name` 或 `--label`，其次 `--text`。
- 截图放 `test/<日期-主题>/`，这里只链接。
