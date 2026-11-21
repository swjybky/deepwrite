# 学术框架阶段拖动排序

## 目标与成功标准

从学术作品菜单打开管理页。按住阶段行 350 毫秒后浮起，蓝线指示插入位置，松手一次保存。退出拖动时顺序保持原样，列表边缘支持自动滚动。

## 环境

macOS Electron 42.5.0，隔离用户数据与合成学术作品。通过作品菜单进入真实管理弹窗，经 Preload、Main 和 Core 读写。浅色 1200×850、14px，深色 1000×680、24px。

## 步骤与命令

- L1 运行学术存储、学术目录、IPC 命令守卫和学术外部控制的定向 Vitest，检查改动文件的 ESLint 与 Prettier。
- L2 运行 `pnpm typecheck`、`pnpm lint:boundary`，在临时目录执行 `electron-vite build --outDir` 并检查启动体积。使用隔离构建运行 `library-groups` 冒烟。
- 浅色流程：[作品菜单](2026-11-20-academic-framework-drag/01-作品菜单.png) → [打开管理](2026-11-20-academic-framework-drag/after-light-1200x850-14.png) → [长按拖动](2026-11-20-academic-framework-drag/03-长按拖动.png) → [Esc 取消](2026-11-20-academic-framework-drag/04-Esc取消.png) → [再次拖动并松手](2026-11-20-academic-framework-drag/05-松手完成排序.png) → [重载重开](2026-11-20-academic-framework-drag/06-重载重开.png)。
- 深色流程：[拖到列表边缘](2026-11-20-academic-framework-drag/07-深色大字号边缘滚动.png) → [松手完成排序](2026-11-20-academic-framework-drag/08-深色排序完成.png)。

## 结果

- 19 项定向测试通过。跨行移动只推进一个版本，旧版本和缺失锚点的请求均被拒绝，原位置放下时版本保持原样。
- 短按、长按前移开、Esc、拖出列表松手均未改变顺序。首项可跨行拖到末尾，持久化后重载一致。上移按钮、启用开关与编辑弹窗可照常操作。
- 浅色静止时列表与按钮对齐，拖动时插入线在浮层上方可见。[改前](2026-11-20-academic-framework-drag/before-light-1200x850-14.png) · [改后](2026-11-20-academic-framework-drag/after-light-1200x850-14.png)
- 深色 24px 下说明换行、操作列完整，拖到列表下边缘可滚动到末项并放下。[改前](2026-11-20-academic-framework-drag/before-dark-1000x680-24.png) · [改后](2026-11-20-academic-framework-drag/after-dark-1000x680-24.png)
- 素材库与技能库冒烟均通过，覆盖长按浮起、跟随、插入提示、清理和持久化。

## 未覆盖与后续

未在 Windows 实机操作。
