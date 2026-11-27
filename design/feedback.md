# 反馈与状态

返回 [DESIGN.md](../DESIGN.md)。

## Toast

- 用 `renderer/src/ui-feedback.ts` 的 `uiMessage.success / error / warning / info(content, { duration?, action? })`，由 `ToastHost.vue` 统一显示：屏幕顶部居中、最多 3 条、默认 3.2 秒自动消失，点击关闭。
- 需要用户顺手处理的提示可带一个 `action`（如“打开系统设置”）；不要用 toast 承载必须确认的决定。
- 文案是完整句子，说清结果或下一步；错误先说发生了什么，再说怎么办。
- 跨进程错误用 `getErrorPayload` 取结构化消息，不要 `String(cause)`（会显示 `[object Object]`）。

## 什么不用 toast

- 必须确认才能继续的风险操作 → 模态确认（[dialogs.md](dialogs.md)）。
- 持续存在的状态（未保存、同步中、运行中、待审阅）→ 页面内固定位置的状态文字或状态点，不弹出。
- 字段说明 → 控件下方的稳定辅助文案。

## 状态表达

- 状态点 6–8px 圆点 + 文字：成功 `--success`，警告 `--warning`，危险 `--danger`，中性 `--text-tertiary`（降低透明度）。
- 状态徽标：胶囊或 10px 圆角，`-soft` 底 + 同色文字，字号 0.642857–0.714286rem。
- 进行中：强调色或 `--text-tertiary` 的轻量指示（小转圈、脉动点），不用整块骨架替换已有内容。
- 空状态：一句说明 + 一个主要入口按钮，居中，`--text-secondary`。

## 加载与 pending（防闪烁）

- **页面级 `saving` / `loading` 只给需要阻断的显式操作**（保存、创建、安装、删除），且只影响触发它的按钮。不得借它改动无关控件的 `disabled`、透明度，也不得用 `v-if="loading"` 整块替换已有内容。
- **即时可逆操作**（开关、勾选、排序）先乐观更新，再用 Main 返回的快照收敛；失败时 toast 提示并从权威数据恢复。并发请求用递增序号丢弃过期回复。参考 `useAgentTeamCatalogCoordinator.setAgentTeamEnabled`。
- **受控控件**：显示值只来自数据，见 [forms.md](forms.md) 的“开关”。
- **共用业务规则**（如“每种类型只启用一个团队”）放 contracts 的纯函数，Main 落盘与 Renderer 预览共用，避免两侧不一致。
- 首次加载可以显示加载态；之后的刷新保留旧内容，在原位更新。

## 未保存与保存

- 有手动保存的编辑页底部用吸底保存栏（`AgentTeamSaveBar.vue`）：左侧“有未保存的修改 / 所有修改已保存”状态，右侧“放弃修改”（仅脏时出现）+ 主保存按钮。
- 离开有未保存修改的页面前确认。
- 自动保存的正文只显示轻量保存状态，保存过程中不锁输入、不移动光标。

## 验证

闪烁不能靠肉眼、类型检查或源码断言确认。在 Browser 窗格用临时 harness（真实组件、真实 store 与 coordinator、带延迟的假 api），用 `requestAnimationFrame` 或 `setInterval` 逐帧采样关键控件的 `checked`、`opacity`、`disabled` 与布局高度；一次点击只应有一次状态变化。harness 放 scratchpad，用完删除。
