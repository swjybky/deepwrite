# Dogfood Report: DeepWrite Slice 1

| Field | Value |
|---|---|
| Date | 2026-07-17 |
| App URL | `http://127.0.0.1:4178/` |
| Session | `deepwrite-qa` |
| Scope | 三栏布局、资源树、对话输入、模型/仿写弹层、文本编辑与折叠 |

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Open total** | **0** |

## Verified workflows

- 1440×900 首屏三栏与 1120×720 紧凑布局无重叠或裁切。
- 创作空间树切换章节后，右侧标题和正文同步更新。
- 正文编辑会进入未保存状态，保存后恢复已保存状态，编辑/预览可切换。
- 官方技能库节点在右侧以只读内容打开。
- 学习仿写可把参考文字转换为中间对话草稿。
- 对话发送、响应中状态与模拟回复工作正常。
- 左右栏均可折叠，并可从中间栏重新展开。
- 模型配置和工作区功能弹层可打开与关闭。
- 浏览器 console 与 page errors 均为空。

## Fixed during QA

1. 树节点最初把折叠图标暴露成嵌套交互控件，导致可访问性树重复朗读节点。已改为每个树节点只暴露一个带 `aria-expanded` 的按钮，并在最终快照中复验通过。
2. 浏览器会自动请求缺失的 `favicon.ico` 并产生一次 404。已增加 DeepWrite SVG favicon 和显式页面引用。

## Evidence

- [Final 1440×900](screenshots/final-1440.png)
- [Compact 1120×720](screenshots/compact-1120.png)
- [Model configuration dialog](screenshots/model-config.png)
