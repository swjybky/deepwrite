# Electron 在沙盒内无法启动

返回 [ERROR.md](../ERROR.md)。

**症状：**`[DEEPWRITE_ELECTRON_SANDBOX]`；`pnpm dev` / `preview` / `smoke` 在 macOS 智能体沙盒内拉不起窗口。

**根因：**macOS 沙盒（`CODEX_SANDBOX=seatbelt`）拒绝窗口服务与 LaunchServices，`--no-sandbox` 解决不了。

**处理：**

- 不在沙盒内重试，不改跑 `pnpm exec electron`、`electron-vite dev/preview` 绕过。
- 申请沙盒外执行该命令，或请用户在系统终端运行并回传结果。
- 拿不到结果时，桌面验收在报告中记为“未验”。

**预防：**新的开发、预览、冒烟、视觉探针入口在拉起 Electron 前调用 `tools/electron-launch-environment.mjs` 的 `assertElectronLaunchAllowed()`。
