# 端口占用与结束进程

返回 [ERROR.md](../ERROR.md)。

**症状：**端口被占，需要结束开发服务器或 harness 进程。

**根因：**`lsof -ti:PORT` 同时列出监听者和连接该端口的客户端，按结果直接 `kill` 曾误杀 Claude 桌面应用的网络服务。

**处理：**

- 只查监听者：`lsof -nP -iTCP:PORT -sTCP:LISTEN`，再用 `ps -o command= -p PID` 核对命令行。
- 只结束本次会话启动的进程；他人遗留的服务不动，换一个端口。
- zsh 中多个 PID 用数组或 `${=VAR}` 拆分。

**预防：**harness 使用不常用的固定端口，并在用完后由启动者关闭。
