# DeepWrite 错误处理

两种用法，都只加载命中的 [error/](error/) 条目：

- **开发前预防：**改动涉及“按改动区域预读”中的区域时，先读相关条目，照其中的“预防”去做；简单改动自行判断是否需要。
- **出错时排查：**遇到报错、测试失败或用户反馈异常时，按下方步骤与“按症状查找”处理。

## 按改动区域预读

| 改动区域 | 预读条目 |
| --- | --- |
| Renderer 界面、样式、组件 | [ui-flicker](error/ui-flicker.md)、[css-class-collision](error/css-class-collision.md)、[cross-process-error](error/cross-process-error.md)、[budget-exceeded](error/budget-exceeded.md) |
| 文案、多语言、`WorkspaceShell.vue` | [budget-exceeded](error/budget-exceeded.md) |
| 智能体工具、子智能体、拆书等批量输出 | [tool-args-validation](error/tool-args-validation.md)、[output-truncation](error/output-truncation.md)、[limit-mismatch](error/limit-mismatch.md) |
| 内置智能体提示词 | [builtin-prompt-fingerprint](error/builtin-prompt-fingerprint.md) |
| contracts schema、作品存储、长篇索引、双端同步 | [schema-compat](error/schema-compat.md)、[limit-mismatch](error/limit-mismatch.md)、[windows-path](error/windows-path.md) |
| Main / Utility 错误路径、IPC | [cross-process-error](error/cross-process-error.md) |
| 拉起 Electron、冒烟、探针、开发服务器 | [electron-sandbox](error/electron-sandbox.md)、[process-kill](error/process-kill.md) |
| 提交、多会话共用工作区 | [mixed-worktree](error/mixed-worktree.md) |
| R2 更新源、版本指针条件写入 | [r2-weak-etag](error/r2-weak-etag.md) |

## 处理步骤

1. **留现场：**完整报错、触发命令或操作、`ErrorPayload.code`、平台（macOS / Windows）与版本。
2. **查表：**按症状或关键词命中“按症状查找”，只读对应条目；未命中按最小复现排查。
3. **先复现再修：**写能失败的测试，修根因。不放宽上限、不调高预算、不 `force`、不绕过沙盒或校验，除非用户同意。
4. **受阻即说明：**两轮尝试无进展，或根因在他人改动、外部服务、用户环境时，停下说明已知事实与选项。
5. **沉淀：**同类错误第二次出现、或排查明显耗时，新建 `error/英文短名.md`，在“按症状查找”加一行，并在“按改动区域预读”登记所属区域。

## 按症状查找

| 症状 / 关键词 | 条目 |
| --- | --- |
| `DEEPWRITE_ELECTRON_SANDBOX`、Electron 起不来 | [electron-sandbox](error/electron-sandbox.md) |
| 界面显示 `[object Object]`、按错误文字分支 | [cross-process-error](error/cross-process-error.md) |
| 点开关整页变灰、按钮位移、打字被吞、光标跳 | [ui-flicker](error/ui-flicker.md) |
| `stopReason: "length"`、“没有生成可交接的摘要” | [output-truncation](error/output-truncation.md) |
| `too_big` / `maximum`、写入成功读取失败、恢复失败 | [limit-mismatch](error/limit-mismatch.md) |
| 工具参数整批被拒、`must have required properties`、子智能体反复重交 | [tool-args-validation](error/tool-args-validation.md) |
| 仅 Windows 失败、“规范化的项目内相对路径”、反斜杠 | [windows-path](error/windows-path.md) |
| 手机同步“结构不兼容”、旧作品打不开、新字段被拒 | [schema-compat](error/schema-compat.md) |
| `exceeds its … B budget`、`WorkspaceShell` 行数测试失败 | [budget-exceeded](error/budget-exceeded.md) |
| 改内置提示词后用户旧版被当成自定义 | [builtin-prompt-fingerprint](error/builtin-prompt-fingerprint.md) |
| 作用域样式无效、元素莫名隐藏 | [css-class-collision](error/css-class-collision.md) |
| 端口被占、要 `kill` 进程 | [process-kill](error/process-kill.md) |
| `typecheck` 报与本次无关的错、工作区有他人改动 | [mixed-worktree](error/mixed-worktree.md) |
| R2 激活 HTTP 412、`If-Match` 使用 `W/` ETag | [r2-weak-etag](error/r2-weak-etag.md) |

## 条目格式

每条不超过 25 行，四节：**症状**（可搜索的原文报错）/ **根因** / **处理**（含关键文件与函数）/ **预防**（对应测试或检查）。
