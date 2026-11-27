# 设置与模型配置

验证日期：2026-11-26（测试实例，CLI 驱动）。截图：[常规设置](../../test/2026-11-23-feature-map/settings.png)、[自定义模型](../../test/2026-11-23-feature-map/settings-models.png)。

## 1. 功能说明

设置页集中管理以下几类配置：

- **常规**：审批模式（请求批准 / 替我审批）、自动保存、页面布局、语言、菜单栏图标、任务完成通知。
- **存储与备份**：自上而下分「本地备份与迁移」（勾选作品、素材库、自建技能库及分组导出单一 `.dwbackup.zip`，以及从备份包预览新增 / 已一致跳过 / 同 ID 冲突并导入）、「存储位置」（作品目录与数据位置切换）、「空间整理」（历史对话冗余快照空间整理，支持低磁盘重试与手动释放 `.bak-v190` 备份）三组。
- **正文文本、外观**：主题、字体、字号。
- **上下文**：上下文压缩。
- **联网搜索**。
- **外部智能体**（MCP）。
- **用量**。
- **模型**：免费模型、自定义模型、新官方小站模型、语音模型、图片模型。
- **各类智能体设置**：创作空间、技能库、素材库，以及更多功能里的智能体。

模型配置决定智能体用哪个模型。密钥由 `safeStorage` 加密，只留在 Main 和 Agent 进程。

## 2. 用户路径

1. 打开设置：左下角头像（如「奶 奶片脆脆鲨」）→ 菜单「设置」。
2. 设置页左侧是分类列表，顶部有「搜索设置…」框。选中分类后，内容显示在右侧。
3. 自定义模型：
   - 分类「自定义模型」下按提供方分组，例如 DeepSeek 3 个模型、OpenAI 3 个模型。
   - 新增模型用「添加大模型」或「添加 JEV 模型」。
4. 选择对话与扩展页用的模型：点模型按钮（如 `Deepseek-v4.1-flash · 深度`，或扩展页面右上角「模型设置」）会弹出三栏模型配置面板——左栏按收藏、全部与模型来源分类，中栏支持搜索与星标收藏，右栏直接选择思考等级、温度或联网开关；「官方小站」分组标题在有官方模型公告时会以单行小字展示最新模型公告（超出单行时省略，鼠标悬停显示完整内容；拉取不到或无公告时静默隐藏、不报错），右侧点击刷新图标可显式向官网重新拉取最新官方模型目录；创作空间还在底栏附带运行模式与正文修改权限。
5. 离开设置页：点「返回应用」。

## 3. 前后端对应

**Renderer**

- 页面框架：`components/SettingsPage.vue`，分类定义在 `settingsCategories.ts`。
- 各分类面板：`*SettingsPanel.vue`，例如：
  - `AppearanceSettingsPanel.vue`
  - `ConfigurationSettingsPanel.vue`
  - `BodyTextSettingsPanel.vue`
  - `MoreFeaturesSettingsPanel.vue`
  - `StorageSettingsPanel.vue`、`LocalBackupExportDialog.vue`、`LocalBackupImportDialog.vue`（`composables/useLocalBackup.ts`）
- 输入框与公共模型弹层：`ConversationModelConfigSelect.vue`、`ModelPickerPanel.vue`、`ModelProviderIcon.vue`。

**Preload**

- `preload/index.ts`（设置相关方法写在入口文件里）：
  - `generalSettings.list` / `generalSettings.save`
  - `workspaceDirectory.*`
  - 各类智能体设置的 `*Agents.list` / `*Agents.save`
- `preload/session-models-api.ts`：`models.list`、`models.save`、`models.test`、`models.cancelTest` 等。
- `preload/local-backup-api.ts`：`localBackup.*`（本地备份盘点、导出、导入预览与应用）。

**Main**

- 常规设置：`main/general-settings-store.ts`
- 模型配置：
  - `main/model-config-store.ts`
  - `model-config-persistence.ts`
  - `model-config-runtime.ts`
  - `deepwrite-site-official-model-config.ts`（官方小站）
  - `deepwrite-free-model-config.ts`（免费模型）
- 用量：`model-usage-store.ts`
- 存储位置与本地备份：`storage-settings-service.ts`、`ipc/local-backup-commands.ts`（Core 侧实现位于 `utilities/local-backup/`，中断恢复日志位于 `local-backup-import-journal.json`）。

**磁盘数据**

配置都在 `profile/config/` 下（安装版在 `@deepwrite/desktop/config/`）：

| 文件 | 内容 |
| --- | --- |
| `general-settings.json` | 常规设置，含 `permissionMode`、`language`、`externalControlEnabled` |
| `models.json` | 模型列表、`defaultModelId`、加密密钥 `encryptedApiKeys` |
| `appearance.json` | 外观 |
| `web-search.json` | 联网搜索 |
| `voice.json` | 语音 |
| `image-models.json` | 图片模型 |
| `workspace-directory.json` | 作品目录 |

## 4. 用验证 CLI 驱动

**界面**

```bash
pnpm -s ctl ui click --label "奶 奶片脆脆鲨"          # 头像按钮；名称随登录账号变化，先 ui snapshot 确认
pnpm -s ctl ui click --role menuitem --name 设置
pnpm -s ctl ui click --role button --name 自定义模型
pnpm -s ctl ui screenshot --out test/<日期-主题>/settings-models.png
pnpm -s ctl ui click --role button --name 返回应用
```

**读设置**（只读）

```bash
pnpm -s ctl app ipc generalSettings.list
pnpm -s ctl app ipc models.list          # 不含密钥，含 defaultModelId
pnpm -s ctl agent models                 # 测试实例的模型清单与默认模型
```

**切主题和字号**

走渲染进程自己的外观状态，与设置页修改效果相同：

```bash
pnpm -s ctl ui theme --mode dark --ui-font-size 16
pnpm -s ctl ui theme --mode light --ui-font-size 14
```

## 5. 注意事项

- **只改测试配置。** 测试实例的配置由 `env seed` 从你的正式配置复制而来，改动只影响测试环境；想回到初始状态，执行 `env stop` 后再 `env seed`。
- **不要直接写外观配置。** 用 `appearance.save` 写入会被界面的外观状态写回覆盖，必须用 `ui theme`。
- **测试模式会拦截线上写入。** 测试模式下，`models.mergeSiteOfficialQuota` 等写线上的请求会被本地拒绝（403 `test_environment.read_only`）；模型调用本身照常放行。
- **头像按钮名称随账号变化。** 按钮名是「首字 昵称」，换账号后会变。
- **`env seed` 会改默认模型。** 测试配置的 `defaultModelId` 被设成小站 `deepwrite-site-official-deepseek-flash`，与正式配置可能不同。
