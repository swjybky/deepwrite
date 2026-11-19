# 开发版在运行，MCP 却报启动超时

返回 [ERROR.md](../ERROR.md)。

**症状：**`external.app_unavailable: 无法连接 DeepWrite（启动超时）`，而本仓库的开发版 `electron .` 仍在运行；`~/.deepwrite/control-dev/` 下只有 `control.sock`，没有 `control.json`，或 pid 不是当前开发版。

**根因：**所有未打包的 Electron 实例（`pnpm dev`、冒烟、探针、其他工作树的开发版）按 home 目录共用 `~/.deepwrite/control-dev`。冒烟和探针用显式数据目录绕过单实例锁，旧代码在它们启动、退出时会删掉开发版的 `control.json`，开关打开时还会抢走端点。开发版不会重新发布，新 MCP 桥只能去拉起应用，第二实例把焦点交回旧窗口后退出，等满 20 秒报超时。

**处理：**

- 已修：`extras/external-control/index.ts` 的 `servedByAnotherInstance()`。状态文件属于另一个 pid、且端点仍能连上时，本实例不启动服务，也不改写或删除状态文件。回归见 `control-lifecycle.test.ts` 的 “beside another instance” 一组。
- 修复前构建出的开发版、其他检出的旧代码仍会出现：按 [TEST.md](../TEST.md)“开发环境：复用或重启”重启开发版，等 `control.json` 的 pid 等于新 Electron 的 pid 再调用 MCP。
- 不手写 `control.json`，不反复调用 `get_app_status` 硬等。

**预防：**多实例共用的文件与端点，清理前核对属主仍在服务。
