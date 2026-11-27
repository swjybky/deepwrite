# 更多功能（扩展智能体与工具页）

验证日期：2026-11-23；整书拆解模型配置：2026-11-24；整书拆解人物失败恢复：2026-11-25（测试实例，CLI + 本地模拟内容拦截）。截图：
- [聊天助手回复](../../test/2026-11-23-feature-map/more-chat-reply.png)
- [资源广场](../../test/2026-11-23-feature-map/more-skill-marketplace.png)
- [短篇拆书](../../test/2026-11-23-feature-map/more-short-book-analysis.png)
- [长篇拆书](../../test/2026-11-23-feature-map/more-long-book-analysis.png)
- [整书拆解备选模型配置](../../test/2026-11-24-decomposition-model-switch/setup-fallbacks.png)
- [整书拆解任务中切换模型](../../test/2026-11-24-decomposition-model-switch/progress-switch-model.png)
- [整书拆解人物内容拦截失败展示](../../test/2026-11-25-decomposition-character-failure/01-failed-content-block-light.png)
- [整书拆解跳过失败人物并完成收尾](../../test/2026-11-25-decomposition-character-failure/04-skipped-and-completed.png)
- [整书拆解结束任务并保留已完成进度](../../test/2026-11-25-decomposition-character-failure/06-ended-preserved-progress.png)

## 1. 功能说明

「更多功能」是左侧栏的一个可展开列表，里面是创作空间以外的功能。

默认显示的条目：

| 条目 | 说明 | 是否用智能体 |
| --- | --- | --- |
| 聊天 | 独立聊天助手，浮在右侧的小窗，可切换聊天上下文；只读，不改文稿 | 是 |
| 资源广场 | 技能、素材、团队的广场，可浏览、安装、发布；数据来自线上 | 否 |
| 短篇拆书分析 | 整篇分析，最多 10 本联合提炼 | 是 |
| 长篇拆书分析 | 按章节范围分批提炼剧情、人物与文风 | 是 |
| 双端同步 | 见 [device-sync.md](device-sync.md) | 否 |

默认隐藏、在「启用其他功能」（设置 → 更多功能）里打开的条目：

- 整书拆解：`long-book-decomposition`（通读与整合阶段各自支持「主模型 + 备选模型链」在额度耗尽时按序自动切换，也支持在停止/暂停时修改模型配置；模型内容拦截或人物建档失败时保留并显示原错误原因且不自动重试被拦截单元，支持跳过失败人物继续完成连续性/审校/收尾，或结束任务并保留已完成写入）
- 长篇转素材库：`long-material-pack`
- 修改分析：`revision-analysis`
- 文风比对：`style-comparison`
- 书名·简介·封面：`book-identity`
- 云端备份：`cloud-backup`
- 朱雀检测：`zhuque-detection`

**分析类功能的运行方式**：
- 走「扩展智能体」，即 `extrasAgent.run`，不走创作空间的 `session.prompt`。
- Renderer 只传 `profileId`，其余参数由 Main 解析。
- 预算由 `assertExtrasAgentBudget` 校验。
- 系统提示词末尾附不可编辑的运行边界。
- 详见 AGENTS.md「扩展智能体」一节。

## 2. 用户路径

1. 点左侧栏「更多功能」展开列表。再点一次会收起。
2. 点列表里的条目。聊天以浮窗打开；其他条目在主区域打开对应页面。
3. 列表最后一项「启用其他功能」跳到设置里的「更多功能」，可以勾选要显示的条目。

## 3. 前后端对应

**Renderer**

- 条目定义：`components/sidebarMoreFeatures.ts`
- 列表：`components/LeftSidebar.vue`，每个条目带 `data-feature-id`
- 页面挂载：`components/WorkspaceFeatureModules.vue`
- 设置：`components/MoreFeaturesSettingsPanel.vue`
- 聊天：`features/chat-assistant/`
- 各功能页面：`renderer/src/extras/<功能>/`，例如 `short-book-analysis`、`long-book-analysis`、`long-book-decomposition`、`agent-team-marketplace`、`book-identity`、`cloud-backup`、`revision-analysis`、`style-comparison`、`zhuque-detection`
- 分析类公共界面：`extras/analysis-ui/`

**契约**

- 条目开关：`packages/contracts/src/more-features-settings.ts`，定义 `MORE_FEATURE_IDS` 和默认可见项

**Preload**

- `preload/extras-agent-api.ts`：`extrasAgent.run`、`extrasAgentConfig.save`、`extrasAgentConfig.reset`
- `preload/marketplace-api.ts`、`agent-team-marketplace-api.ts`：广场接口
- `preload/analysis-apis.ts`、`short-book-analysis-api.ts`、`long-book-analysis-api.ts`：分析接口
- `preload/long-book-decomposition-api.ts`：`longBookDecomposition.createJob`、`longBookDecomposition.listJobs`、`longBookDecomposition.getJob`、`longBookDecomposition.control`、`longBookDecomposition.updateModels` 等整书拆解接口

**Main（extras）**

- 云端备份由 `extras/cloud-backup/service.ts` 负责预览、打包与传输。注册项目清单由 Core 通过 `catalog.listBackupProjects` 提供，恢复时通过 `catalog.restoreBackupFiles` 在 Core 创建或覆盖项目文件。

- `extras/agents/`：
  - `run-service.ts`
  - `task-resolver.ts`（`resolveExtrasTask`）
  - `profile-catalogs.ts`
  - `chat/`（聊天档案）
  - `long-book-decomposition/`、`long-material-pack/`
  - `prompts/`
- 广场客户端：`MarketplaceClient`，测试模式下只放行读请求

**智能体**

- `packages/pi-runtime-adapter/src/extras/`：扩展智能体定义、工具、运行计划

## 4. 用验证 CLI 驱动

```bash
# 展开列表（已展开时不再点，否则会收起）
pnpm -s ctl ui eval "document.querySelector('[data-nav-id=more]').getAttribute('aria-expanded')"
pnpm -s ctl ui click --selector "[data-nav-id=more]"

# 打开条目：用 data-feature-id，条目的可访问名称是描述文字
pnpm -s ctl ui click --selector "[data-feature-id=chat-assistant]"
pnpm -s ctl ui click --selector "[data-feature-id=skill-marketplace]"
pnpm -s ctl ui click --selector "[data-feature-id=short-book-analysis]"
pnpm -s ctl ui click --selector "[data-feature-id=long-book-analysis]"
```

**聊天助手，真实模型**

```bash
pnpm -s ctl logs mark --name before-chat
pnpm -s ctl ui fill --label 给聊天助手发送消息 --value "17 乘以 3 等于多少？只回答数字。"
pnpm -s ctl ui press Enter --label 给聊天助手发送消息
pnpm -s ctl ui wait --label 停止生成 --gone --timeout 120     # 生成中输入框旁是「停止生成」按钮
pnpm -s ctl ui eval "document.body.innerText.includes('51')"
pnpm -s ctl logs errors --since before-chat
```

2026-11-23 实测：模型回答「51」，约 1 秒；另一条说明类问题约 3 秒。

## 5. 注意事项

- **条目名称和看到的文字不一样。** 列表条目的可访问名称取自 `title`，也就是描述文字（如「打开独立聊天助手」），不是标题「聊天」。`--role --name` 和 `--label` 要写描述文字；用 `--selector "[data-feature-id=…]"` 最稳。
- **断言的词不要出现在提问里。** 例如提问里写了「CHAT-OK」，用户气泡和会话标题也会包含它，`innerText.includes` 会误判。要用问题的结果判断，比如问 17×3 就查「51」，或者等「停止生成」按钮消失。
- **聊天只读。** 聊天助手不改文稿。分析类功能会写结果文件或任务目录；整书拆解等功能耗时长，要用 `logs tail --source model-calls` 观察子任务。
- **广场在测试模式下只读。** 广场数据来自线上，测试模式只放行读：能浏览、能看详情；发布、点赞、安装计数等写入会被本地拒绝，返回 403 `test_environment.read_only`。
- **隐藏条目要先在设置里打开。** 打开后再按 `data-feature-id` 定位。
