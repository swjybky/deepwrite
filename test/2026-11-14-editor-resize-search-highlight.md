# 正文栏拖动时搜索高亮的无用布局读取

## 目标与成功标准

- 用户反馈 Windows 11 内部正文栏左右拖动偶发严重卡顿。
- 消除搜索未打开或无匹配时的高亮布局读取；有匹配时仍同步尺寸与滚动。

## 环境

- 本地 macOS，Vue 自定义测试 Renderer，10 万字合成正文。
- 工作区存在其他改动，本次仅修改搜索高亮组件及对应测试。

## 步骤与命令（L1 / L2）

- 修复前回归用例失败：搜索关闭时仍读取 `scrollHeight`。
- `pnpm vitest run apps/desktop/src/renderer/src/components/EditorSearchHighlight.test.ts apps/desktop/src/renderer/src/utils/editorSearchHighlight.test.ts apps/desktop/src/renderer/src/utils/textareaMirror.test.ts`
- 对改动文件运行 ESLint 和 Prettier 检查。
- `pnpm exec vue-tsc --noEmit -p apps/desktop/tsconfig.web.json`

## 结果

- 6 个测试通过；ESLint、Prettier、Renderer 类型检查通过。
- 搜索关闭、无匹配、关闭后编辑或收到遗留尺寸回调均不读取高亮布局；重新开启有匹配的搜索恢复同步。
- 模板与样式未改动；未进行截图验证。

## 未覆盖与后续

- 未在 Windows 11 实机复现、测帧或验证拖动改善，尚不能确认用户卡顿的完整根因。
- 本次只移除确定存在的额外布局计算；长正文自身重排和聊天区布局仍需实机性能采样。
