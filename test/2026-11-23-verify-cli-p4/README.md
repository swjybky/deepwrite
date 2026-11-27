# 验证 CLI P4：五类真实模型场景

生成时间：2026-11-23T12:34:24.797Z

## 环境

- 测试实例：运行中，应用版本 1.9.0
- doctor：健康

## 日志

- 未指定日志标记，未汇总

## 智能体场景

| 场景 | 结果 | 状态 | 耗时 | 工具 | 未通过 | 报告 |
| --- | --- | --- | --- | --- | --- | --- |
| academic | 未通过 | completed | 79s | edit 5、read 4 | document:3 方法设计 · 写作指引 含「DW-ACADEMIC-F99E」；document:3 方法设计 · 正文 含「DW-ACADEMIC-F99E」；document:3 方法设计 · 正文 含「[待补数据: 配对阅读时间]」 | [rerun/academic.json](rerun/academic.json) |
| long | 通过 | completed | 48s | edit 2、list 1、read 2 | - | [rerun/long.json](rerun/long.json) |
| academic | 未通过 | waiting_for_user | 33s | edit 2、read 2 | status=completed | [scenarios/academic.json](scenarios/academic.json) |
| long | 未通过 | completed | 54s | edit 2、read 4 | document:第一章 · 正文 含「DW-LONG-0CCC」 | [scenarios/long.json](scenarios/long.json) |
| mystery | 通过 | completed | 35s | edit 1、read 2 | - | [scenarios/mystery.json](scenarios/mystery.json) |
| script | 未通过 | completed | 33s | edit 2、read 4/2✗ | noFailedTools | [scenarios/script.json](scenarios/script.json) |
| short | 通过 | completed | 83s | edit 2、read 3 | - | [scenarios/short.json](scenarios/short.json) |

## 截图

- [academic-rerun-empty.png](academic-rerun-empty.png)
