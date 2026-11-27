# 规则与来历

这里记录仓库里每条自动检查规则从哪来。规则本身写在代码里，这份文件只写“查什么、在哪、为什么加”。新增或删除规则时同步更新这一页（见 `.agents/skills/ccs-mode/SKILL.md` 的「D. 日常维护」）。

所有规则都由统一检查执行：日常用 `pnpm -s ctl check changed`，全量用 `pnpm -s ctl check all`，提交前由 `.githooks/pre-commit` 自动跑暂存区检查。

## 类型检查（`tsconfig.base.json`、`apps/desktop/tsconfig.web.json`）

| 规则 | 来历 |
| --- | --- |
| `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` | 第三层之前已开启 |
| `noImplicitReturns`、`noImplicitOverride`、`noFallthroughCasesInSwitch`、`allowUnreachableCode: false` | 2026-11-23 加开，当时修了 16 处隐式返回和 1 处不可达代码 |

2026-11-23 评估后暂不开的（括号里是当时的报错数）：

- `noUnusedLocals` / `noUnusedParameters`（24）：ESLint `no-unused-vars` 已覆盖；`vue-tsc` 把模板里 `ref="x"` 用到的变量误报为未使用。
- `noPropertyAccessFromIndexSignature`（2,819）：只改写法（`obj.key` → `obj["key"]`），不抓缺陷。
- `.mjs` 开 `checkJs`（约 2,200）：大多是隐式 `any`，要给 `tools/` 和脚本补 JSDoc 类型才有意义。

## ESLint 通用（`eslint.config.js`）

| 规则 | 查什么 | 来历 |
| --- | --- | --- |
| `linterOptions.noInlineConfig` | 行内 `eslint-disable` 等注释一律失效 | 规则不能被就地豁免，避免智能体加注释绕过 |
| `@typescript-eslint/ban-ts-comment` | 禁止 `@ts-ignore`、`@ts-expect-error`、`@ts-nocheck` | 清理时有 8 处 `@ts-expect-error`，都用来读源码文本测试 |

## ESLint 自定义（`tools/eslint-rules.mjs`）

| 规则 | 范围 | 查什么 | 来历 |
| --- | --- | --- | --- |
| `deepwrite/no-double-cast` | 应用与包的非测试代码 | `as unknown as` | 生产代码有 15 处，其中资料库工具读取了契约里根本不存在的字段 |
| `deepwrite/no-json-clone` | 同上 | `JSON.parse(JSON.stringify(…))` | 22 处手写，另有 2 份 `ipcSafeJson`；统一为 `@deepwrite/shared` 的 `jsonClone` |
| `deepwrite/no-local-helper` | 同上 | 重新定义已有唯一实现的工具函数 | `isRecord` 有 42 份、原子写有 20 份、`isNodeError` 有 12 份、对话框焦点处理有 9 份 |
| `deepwrite/no-inline-rejection` | Main、extras | 手写 `status: "rejected"` 结果 | 131 处手写，统一为 `main/ipc/errors.ts` 的 `rejectedResult` |
| `deepwrite/no-core-registry` | Main、extras | 引用 Core 的注册表文件名 | 云备份曾在 Main 里直接改写 `catalog-registry.json`，绕过唯一写入者 Core |
| `deepwrite/renderer-bridge` | Renderer | 直接访问 `window.deepwrite` | 60 个文件直接访问、17 种各自的包装；统一为 `renderer/src/api/deepwrite.ts` |
| `deepwrite/renderer-storage` | Renderer | 直接用 `localStorage` | 16 个文件直接用；统一为 `utils/uiStorage.ts` |
| `deepwrite/renderer-native-dialog` | Renderer | `alert` / `confirm` / `prompt` | 8 处原生确认框；统一为 `ui-confirm.ts` 的 `uiConfirm` |
| `deepwrite/renderer-error-text` | Renderer | 手写 `error.message` 文案、本地 `errorMessage` | 14 个本地包装，部分绕过翻译；统一为 `i18n/errors.ts` 的 `formatError` |

## ESLint 导入限制（`no-restricted-imports`）

| 范围 | 禁止 | 来历 |
| --- | --- | --- |
| Main、extras（`mainFileWriters` 名单外） | `node:fs` 的写入函数 | 云备份恢复曾由 Main 直接写作品文件；名单内只有 Main 自有配置、存储迁移和用户选定路径的导出 |
| 除 `utilities/conversation-storage/` 外的应用代码 | `node:sqlite` | SQLite 只在对话存储里用 |
| `packages/pi-runtime-adapter` | `node:fs`、`node:child_process`、`node:sqlite` | 智能体经 Core 只读桥读作品，改稿走 proposal |
| 测试文件 | `?raw` 导入源码、`virtual:*` 样式文本 | 用户要求不写读源码文本的测试；清理时删掉了 128 处 `?raw` 导入 |

## 仓库规则（`tools/control/lib/repo-rules.mjs`，可用 `pnpm -s ctl check rules [规则名]` 单独跑）

| 规则 | 查什么 | 来历 |
| --- | --- | --- |
| `dead-files` | 从构建入口和脚本都到不了的源文件 | 清理时删掉 42 个、约 1.6 万行；其中有测试一直在测死代码 |
| `duplicates` | 300 字符以上相同函数体出现在多个文件 | 拆分做了一半，`folder-catalog-store` 和 contracts 的 `catalog` 各留一份，后者已有 13 个 schema 不一致 |
| `layers` | 跨进程层的代码导入 | Core 代码放在 extras 下、Main 与 Core 互相导入；唯一例外是两边共用的配置锁 |
| `dependency-sources` | 依赖不来自 catalog 或 workspace | `qrcode`、`@types/qrcode` 写死了版本 |
| `sensitive-content` | 测试、夹具、Mock 里的自有域名、公网 IP、像真的凭据 | `AGENTS.md` 的敏感信息约定 |
| `electron-launch-guard` | 启动 Electron 的脚本没有调用 `assertElectronLaunchAllowed()` | `AGENTS.md` 的沙盒约定 |
| `ipc-routes` | Preload 发出的命令在 Main 没有路由 | 长篇「解决冲突」按钮从 1.5.0 起一直报 `Unreachable command variant` |
| `external-skill` | 外部控制的工具名和错误码没有写进 Skill | `SKILL.md` 漏了 10 个工具、4 个错误码 |

## Git 钩子（`.githooks/`，`pnpm install` 时自动启用）

| 钩子 | 做什么 | 来历 |
| --- | --- | --- |
| `pre-commit` | 对暂存区跑 `check changed --staged` | 第三层统一检查入口 |
| `pre-push` | 拦下 `tavern` 分支、指向它的标签和带酒馆预设代码的提交 | `AGENTS.md`：酒馆分支仅限本地 |
