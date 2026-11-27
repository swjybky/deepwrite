# 双端同步

验证日期：2026-11-23（测试实例，只打开了连接页；测试模式下同步不会向线上写入）。截图：[连接页](../../test/2026-11-23-feature-map/more-device-sync.png)。

## 1. 功能说明

桌面端和手机端（`deepwrite-app` 仓库）通过用户自己的 WebDAV 网盘接续写作，例如坚果云。

- **同步内容**：作品、资料库、对话记录（独立通道），以及可选的模型配置（含加密的 API Key）。
- **同步范围**：可以按分组选择。
- **初始化**：检测网盘已有内容，选择采用本机还是网盘的版本。
- **冲突处理**：出现冲突时逐项选择保留哪一边。

两端共用的同步模块逐字节一致，改一端必须同步改另一端。

## 2. 用户路径

1. 左侧栏点「更多功能」，再点「双端同步」，进入「连接自己的网盘」页。
2. 选网盘服务，填网盘账号和应用密码。可展开「高级设置」，例如自定义地址。填好后点「连接并继续」。
3. 连接后依次进入：初始化（选同步范围、处理已有内容）→ 同步状态、改动列表、冲突卡。

## 3. 前后端对应

**Renderer**

- 主页面：`extras/device-sync/DeviceSyncPage.vue`
- 连接表单：`SyncConnectionForm.vue`
- 初始化：`SyncInitializationPanel.vue`
- 同步状态与进度：`SyncStatusCard.vue`、`SyncProgressPanel.vue`
- 改动与内容：`SyncChangesPanel.vue`、`SyncContentPanel.vue`
- 冲突：`SyncConflictCard.vue`

**Preload**

- `preload/device-sync-api.ts`：`deviceSync.request`，单一入口，按请求类型分发。

**Main（extras）**

- 入口：`extras/device-sync/index.ts`
- WebDAV 访问：`webdav*.ts`
- 同步引擎：`engine/`
- 本机状态：`local-storage.ts`
- 模型配置同步：`model-workspace.ts`

**Core Utility**

`utilities/device-sync-*.ts`，负责工作区盘点、事务、恢复与初始化。

**数据位置**

- 本机同步状态：`device-sync.json`。由 `extras/device-sync/local-storage.ts` 写入；首次连接前不存在，`env seed` 也不复制它。
- 远端：用户网盘下的 DeepWrite 目录。

## 4. 用验证 CLI 驱动

**界面：只到连接页为止**

```bash
pnpm -s ctl ui click --selector "[data-nav-id=more]"            # 展开「更多功能」
pnpm -s ctl ui click --selector "[data-feature-id=device-sync]"
pnpm -s ctl ui screenshot --out test/<日期-主题>/device-sync.png
```

**同步逻辑：用单测和冒烟验证，不连真实网盘**

```bash
pnpm exec vitest run apps/desktop/src/extras/device-sync apps/desktop/src/utilities/device-sync
```

## 5. 注意事项

- **测试实例不会写网盘。** 测试模式只放行 WebDAV 的读方法（GET、HEAD、PROPFIND、OPTIONS），写入在本机就被拒绝。即使填了真实账号，也不会改动网盘内容；但会读取网盘，所以不要用测试实例连你的正式网盘做验证。
- **没有网盘凭据。** `env seed` 不复制同步配置，测试实例默认未连接。真要端到端验证，需要单独准备一个测试网盘账号，并临时允许写入；目前 CLI 不支持。
- **改同步要两端一起改。** 改动同步协议或共享模块时，必须同时改 `deepwrite-app`，并且两端同时发版。
- **「更多功能」条目要用选择器定位。** 这些条目的可访问名称是描述文字，例如「使用自己的网盘接续写作」，不是标题「双端同步」。用 `--selector "[data-feature-id=…]"` 最稳。
- **点「更多功能」会切换展开状态。** 再点一次就收起，所以连续操作前先看 `aria-expanded`。
