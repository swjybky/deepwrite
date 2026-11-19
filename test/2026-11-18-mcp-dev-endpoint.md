# 冒烟不再删除开发版 MCP 端点

## 目标与成功标准

- 共用 home 的另一个实例（冒烟、探针）关着开关启动、退出时，不删除正在服务的开发版的 `control.json`。
- 开关打开时，不抢走仍在服务的端点；原属主退出后可以接管。
- 孤立状态文件（属主已死，或端点连不上）仍照旧清理。

## 环境

macOS，本仓库 main 工作区（混有他人未提交改动），开发版 `pnpm dev`，`deepwrite-dev` MCP。

## 步骤与命令

- L1：先补 4 个用例，2 个按预期失败，复现了删除与抢占；修复后 `pnpm vitest run apps/desktop/src/extras/external-control/`。
- L1：改动的 3 个文件过 Prettier、ESLint，跑 `tsc -p apps/desktop/tsconfig.node.json`。
- L2：`pnpm build` 后重启开发版，在开发版运行时跑 `electron-smoke.mjs --library-groups-only`，前后各调一次 `get_app_status`。

## 结果

- 通过：11 个文件共 151 项。
- 通过：格式、ESLint、Node 侧类型检查。
- 修复前现场：开发版已运行 1 小时 13 分，`control.json` 已丢失，`get_app_status` 报启动超时。
- 修复后：冒烟通过；开发版 10:35:43 写入的 `control.json`（pid 9938）在冒烟后未变，`get_app_status` 正常。
- 失败（与本次无关）：`pnpm build` 末尾的 Renderer 体积预算超出 542 B，来自工作区里他人的 Renderer 改动，electron-vite 产物已正常生成。

## 未覆盖与后续

- Windows 命名管道未实测，同一逻辑由单测覆盖。
- 两个都开着开关的开发版（不同 `DEEPWRITE_DEV_USER_DATA`）时，后启动的不提供 MCP，只记一条警告。
