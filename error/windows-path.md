# 仅 Windows 失败的路径问题

返回 [ERROR.md](../ERROR.md)。

**症状：**只有 Windows 用户报错，如“项目事务路径必须是规范化的项目内相对路径”；macOS 与 Linux 测试全过。

**根因：**用 `node:path` 的 `join` / `relative` 拼项目内相对路径，Windows 得到 `records\xxx.json`，被事务校验拒绝。

**处理：**

- 项目内相对路径（事务、清单、索引）一律用 `/` 拼接；只有访问真实磁盘时才用 `node:path` 转换。
- 比较路径前统一分隔符与大小写规则。

**预防：**测试 mock `node:path` 为 `path.win32` 复现；改动后确认 CI 的 Windows 任务通过。
