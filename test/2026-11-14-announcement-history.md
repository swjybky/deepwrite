# 公告历史真实页面验证

## 目标与成功标准

公告时间轴按时间倒序切换；历史来自本地；切换不请求数据；长内容可滚动；主题、大字号和最小窗口不溢出。

## 环境

macOS，Electron 42.5.0 / Chromium 148；真实 Vue 组件、全局 CSS、AppAlertStore、Main IPC 与 Preload 校验。
临时 userData，18 条合成公告；远端 fetcher 为合成实现，写入后重建 Store 并模拟离线；不使用安装版与真实作品。
基线为临时 worktree 的 HEAD `7cef1f92` 公告组件（仅调整探针中的导入路径）；改后为当前工作区。截图视口为 CSS 像素，PNG 为 Retina 分辨率。

## 步骤与命令（L2）

- 启动前执行 `assertElectronLaunchAllowed()`；临时探针经 Vite 构建为本地文件，以 Electron `loadURL(file:)` 加载，`capturePage()` 截图。
- 执行 `node /tmp/deepwrite-announcement-scratch/build.mjs`，通过真实 IPC 读取历史，点击时间轴，检查 DOM、滚动位置、请求计数及控制台。
- 逐对检查浅/深色 1200×900 / 14px、1000×680 / 24px，再截长公告、滚动到底和空状态；探针与临时 worktree 验证后删除。

## 结果（通过）

- 浅色 1200×900：新增左侧时间轴，内容对齐、换行正常。[前](2026-11-14-announcement-history/before-light-1200x900-14.png) / [后](2026-11-14-announcement-history/after-light-1200x900-14.png)。
- 深色 1200×900：表面、文字与选中态跟随主题，无横向溢出。[前](2026-11-14-announcement-history/before-dark-1200x900-14.png) / [后](2026-11-14-announcement-history/after-dark-1200x900-14.png)。
- 浅色 1000×680 / 24px：日期完整、预览省略，正文可滚动，底部按钮可见。[前](2026-11-14-announcement-history/before-light-1000x680-24.png) / [后](2026-11-14-announcement-history/after-light-1000x680-24.png)。
- 深色 1000×680 / 24px：左右栏无重叠，头部与底部保持可见。[前](2026-11-14-announcement-history/before-dark-1000x680-24.png) / [后](2026-11-14-announcement-history/after-dark-1000x680-24.png)。
- 点击第 17 次及最早公告，正文正确；首次展示第 18 次；一次历史切换前后 fetch 次数均为 20（包含种入 18 次与两次打开），切换未新增请求。
- 长公告与历史列表独立滚动到底，按钮保持可见。[长公告](2026-11-14-announcement-history/after-dark-1000x680-24-history-long.png) / [滚动后](2026-11-14-announcement-history/after-dark-1000x680-24-history-scrolled.png)。
- 重建 Store 后离线展示 18 条历史；Esc 关闭后重新打开正常；无本地记录时显示“暂无公告”。[空状态](2026-11-14-announcement-history/after-dark-1000x680-24-empty.png)。
- 11 张 PNG 均小于 1 MB；控制台错误为零。[测量数据](2026-11-14-announcement-history/result.json)。

## 未覆盖与后续

未连接生产公告服务，未测试安装版导航入口、Windows、多语言和其他主题预设；本轮验证针对公告组件及其真实存储 / IPC 链路。未修改产品代码。
