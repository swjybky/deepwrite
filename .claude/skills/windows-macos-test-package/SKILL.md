---
name: windows-macos-test-package
description: 构建并验证 DeepWrite Windows、macOS 测试安装包；本地不跑全量测试，只测本轮改动，用户说已验证则直接打包。用于打包、测试包、Win/Mac 包及相关流程修改；版本递增和发布另用 package-patch-release。
---

# DeepWrite 测试安装包

默认只生成本地测试包，保持当前版本。递增或发布时再读 [package-patch-release](../package-patch-release/SKILL.md)；正式签名、公证须明确授权与凭据。

目标是**一次编排出包**：除第 1 节对本轮改动的补测外，不另做任何测试。

## 1. 只测本轮改动（开头一句话告诉用户测了什么）

本地打包**一律加 `--skip-verify`**：编排器只构建、打包并做包内冒烟。全量 `pnpm verify`（含拆书规模测试、磁盘集成测试）由 CI 在每次推送 main 和 PR 时跑，本地不重复；只有用户明确要求“跑全量”时才去掉该参数。

打包前按下表决定是否补测，没改动的功能不测：

| 情况 | 打包前做什么 |
| --- | --- |
| 用户说过代码已验证、已过一轮、直接打包；或本会话已测过且之后没改代码；或仅改版本号、发布重试 | 什么都不测，直接打包 |
| 本轮改了源码且尚未验证 | 只对本轮改动的文件跑 TEST.md 的 L1：`pnpm vitest related --run <改动文件>`、`pnpm exec eslint <改动文件>`、`pnpm exec prettier --check <改动文件>`；改了类型或契约再加 `pnpm typecheck` |

“本轮改动”指本会话改过、或用户点名的文件，不把工作区里其他会话的旧改动当成待测范围。

## 2. 执行一个批次

从仓库根目录执行覆盖请求的最小组合，末尾加 `--skip-verify`（如 `pnpm pack:test:mac:arm64 --skip-verify`）：

| 请求目标                    | 命令                       |
| --------------------------- | -------------------------- |
| Mac ARM、Mac Intel、Windows | `pnpm pack:test:desktop`   |
| 两种 Mac 架构               | `pnpm pack:test:mac`       |
| macOS ARM                   | `pnpm pack:test:mac:arm64` |
| macOS Intel                 | `pnpm pack:test:mac:x64`   |
| Windows x64                 | `pnpm pack:test:win`       |
| Linux x64                   | `pnpm pack:test:linux`     |
| 全部（含 Linux）            | `pnpm pack:test`           |

**不要做的事：**

- 跑全量 `pnpm verify` / `pnpm test`，或在上表之外另测未改动的功能；启动开发版 / 安装包做额外的手动冒烟。
- 把多平台拆成几个命令（每个都会重新构建），或额外构建未请求的平台。批次串行，不并行。
- 直接调用 electron-builder 绕过编排器；它负责锁定 Electron 版本、包内冒烟和退出前恢复开发运行时。
- 编排器正常结束后再跑 `pnpm electron:ensure` 或 `verify-test-package.mjs`，这些已自动完成。

macOS 冒烟需要 `assertElectronLaunchAllowed()` 放行。已知在 Codex Seatbelt 内时，直接申请沙盒外执行该命令，不先在沙盒内失败一次，不用 `--no-sandbox` 绕过。

等待时约 30 秒查看一次输出，阶段变化（`PACKAGE_STEP`、测试总结、builder 进度、`PACKAGE_*_OK`）才更新进度。长时间无输出先查子进程与超时设置，见 [卡顿与超时诊断](references/troubleshooting.md)；没卡住就不必读它。

## 3. 失败时

先读错误属于哪个阶段，只重跑失败项，不重跑整条流水线：

| 失败 | 处理 |
| --- | --- |
| 打包前 L1 检查失败 | 只修本轮改动造成的问题，只重跑失败的那项检查，通过后打包 |
| `pnpm build` 失败 | 按报错最小修复，重新执行同一条打包命令 |
| 包内冒烟失败，包未变 | 有日志依据时只复验该架构：`pnpm --dir apps/desktop exec node scripts/verify-test-package.mjs mac x64`（ARM 改 `arm64`），结束后跑一次 `pnpm electron:ensure` |
| 修改了 Main、Preload、Renderer、Utility、契约、构建输入或 Main 内 `smoke*.ts` | 旧包作废，对新改的文件补 L1 后重建受影响目标 |
| 构建、签名、下载失败 | 先定位配置、缓存、网络或环境原因，再重建；同一错误没有新诊断依据时不重试 |

同一个失败最多诊断修复两轮；仍失败就停下报告，不无限循环。缺目标环境、凭据或授权时，完成不受影响的目标并说明剩余项。重试沿用本轮版本，不再递增。

## 4. 交付

- 编排器的 `verify-test-package.mjs` 已检查安装包非空、包内运行时完整、首次启动与重新打开冒烟；Mac 另含 DMG 校验、`codesign --verify --deep --strict`、`Signature=adhoc`、ZIP 完整性。直接引用其输出，不重复执行这些检查。
- 只用 `ls` 核对请求目标的文件名、版本、大小和 `latest*.yml` 引用；两种 Mac 架构的清单应同时保留。
- 简洁报告：版本、产物路径、打包前测了哪些文件（或“用户已确认验证，未另测”）、冒烟结果、必要修复。出现 `PACKAGE_SMOKE_SKIPPED` 或跨平台构建时写“只完成构建和完整性检查，未做目标平台运行验证”。
- Mac 保持 `identity: "-"`、`hardenedRuntime: false`、`notarize: false`；ad-hoc 签名不等于 Developer ID 或公证，不承诺下载后无提示打开。
