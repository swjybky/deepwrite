# DeepWrite 项目协作规范

## 前端反馈与布局

- 表单校验警告、操作错误、成功和普通提示，统一使用不参与页面布局的浮层反馈，例如 toast、message、notification；无需用户处理的提示应自动消失。
- 禁止把临时警告或错误块插入表单、弹窗或操作按钮之间，以免改变容器高度、挤压按钮、造成页面跳动。
- 只有必须由用户确认后才能继续的风险操作才使用模态确认弹窗；普通校验和操作结果优先使用短暂浮层提示。
- 字段说明可以作为稳定的辅助文案保留，但不得用它承载临时警告或错误状态。

## Windows 与 macOS 测试安装包

- 当前桌面端是 Electron 工程，统一使用 `electron-builder` 和 `apps/desktop/electron-builder.yml` 打包；不得使用旧 Write Claw / DeepSeekWrite 项目的 Python、PyInstaller 或旧 DMG 脚本。
- 用户只说“打包”“打测试包”“打 Win 包”或“打 Mac 包”时，默认生成不会发布的测试包。Windows 测试包可以不做代码签名；Mac 测试包必须对完整 `.app` 做 ad-hoc 签名，但不做 Apple 公证。只有用户明确要求“正式包”“发布包”并提供或确认签名条件后，才配置 Developer ID 签名、公证或上传发布。
- 打包前必须从仓库根目录运行对应的 `pnpm pack:test:*` 命令。命令会先执行 `pnpm verify`，不得跳过类型检查、边界检查、测试和构建，也不得直接复用无法确认是否最新的 `apps/desktop/out`。
- `pnpm pack:test:*` 必须通过 `tools/run-test-package.mjs` 统一编排，不得把脚本退回为直接串联 electron-builder。编排器会显式锁定打包用 Electron 版本，并在成功或失败退出前通过 `tools/ensure-electron-runtime.mjs` 恢复、验证当前主机的开发 Electron；打包完成后 `pnpm dev` 必须仍可启动。
- 指令与命令映射：未指定平台的“打包”或“打全部测试包”使用 `pnpm pack:test`；Windows x64 使用 `pnpm pack:test:win`；Mac Apple Silicon / arm64 使用 `pnpm pack:test:mac:arm64`；Mac Intel / x64 使用 `pnpm pack:test:mac:x64`；同时生成两种 Mac 架构使用 `pnpm pack:test:mac`。
- Windows 测试包优先在 Windows x64 环境构建；Mac 包必须在 macOS 构建。在 Apple Silicon Mac 上构建或运行 Intel 包时，需要具备可用的 x86_64 / Rosetta 环境。
- 测试包输出目录固定为 `apps/desktop/release/`，文件名必须保留 `DeepWrite-<version>-<os>-<arch>-test.<ext>` 格式，不得临时改名覆盖其他架构或版本。
- `apps/desktop/scripts/electron-builder-before-build.cjs` 会阻止 electron-builder 把 pnpm 依赖树重复装进 ASAR，因为当前运行时依赖已由 electron-vite 编译到 `out`。如果以后引入未打包的运行时依赖或原生 Node 模块，必须同步调整该钩子和 `files` 配置，并增加对应的安装包内运行验证。
- Mac 测试包使用 `apps/desktop/electron-builder.yml` 中的 `identity: "-"` 让 electron-builder 对 Electron Framework、Helpers 和顶层 App Bundle 完成 ad-hoc 签名，并设置 `hardenedRuntime: false`、`notarize: false`。不得改回 `identity: null`：完全跳过签名会让 x64 App 未签名、arm64 App 只保留不完整的 linker ad-hoc 签名，经微信、浏览器等渠道下载并触发 Gatekeeper 后，可能被误报为“应用已损坏”。
- 旧 Write Claw / DeepSeekWrite 打包流程中可借鉴的只有“组装完整 `.app` 后执行 `codesign --force --deep --sign -`，再执行 `codesign --verify --deep --strict`”这一签名原则；当前 Electron 工程应优先使用 electron-builder 原生的 `identity: "-"`，不得重新引入旧 PyInstaller 或 DMG 脚本。
- `apps/desktop/scripts/verify-test-package.mjs` 必须同时验证 DMG 校验和、`codesign --verify --deep --strict` 成功，并确认顶层 App Bundle 的签名详情包含 `Signature=adhoc`。只运行 `apps/desktop/release/mac*/DeepWrite.app` 的冒烟流程不能证明微信下载后的安装体验，因为未隔离的构建目录不会触发 Gatekeeper。
- ad-hoc 签名只修复 App Bundle 的代码完整性，不会建立 Apple 信任链，也不能替代 Developer ID 签名和公证。通过微信、浏览器等渠道接收后，文件可能被重新添加 `com.apple.quarantine`；测试者仍可能需要右键打开、在“隐私与安全性”中选择仍要打开，或在确认包可信后手动移除隔离属性。不得声称 ad-hoc 测试包可以在所有 Mac 上无提示直接打开。
- 交付 Mac 测试包前检查本地生成的 DMG 是否意外继承了旧文件的 `com.apple.quarantine`，若存在则从发布产物移除；但必须明确，传输工具可能在接收端重新添加该属性。
- 成功标准：对应安装包存在且非空；同时检查生成的未打包应用目录，并尽可能运行安装包内的 DeepWrite 冒烟流程，确认主进程、Renderer、Preload 以及 core / agent / tool 三个 Utility 均可启动。若受当前操作系统限制无法运行目标平台产物，必须明确报告“只完成构建，未完成目标平台运行验证”。
- 打包失败时报告失败的平台、架构、具体步骤和关键终端输出；不得在缺少签名凭据、目标平台环境或验证结果时声称正式发布包可用。
