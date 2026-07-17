# Dogfood Report: DeepWrite Slice 2

| Field | Value |
|---|---|
| Date | 2026-07-17 |
| App | DeepWrite Electron production build |
| Session | `deepwrite-electron-clean` |
| Scope | Renderer → Preload → Main → Agent Utility → Pi/Faux → Renderer |

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Open total** | **0** |

## Verified workflows

- 桌面运行时显示就绪，Core / Agent / Tool Utility 健康检查通过。
- 发送真实 `session.prompt` 后，Thinking 和多段回复事件归并到同一条助手消息，最终恢复可发送状态。
- Faux 完成态准确显示主文稿标题、快照字数、用户请求和“未修改 / 未保存”边界。
- 未应用标题和正文收起右栏后仍能恢复；再次发送时 Faux 读取到恢复后的实时标题与 22 字草稿。
- 打开“自然续写”技能时，右侧显示“仅浏览 · 未附加”，中间主上下文仍保持第三章。
- 新建对话清空内存消息并显示 Slice 2 能力范围明确的空态。
- 元素具备可访问名称，添加上下文按钮在功能未接入时保持禁用。
- 最终生产构建的 page errors 与 Renderer console 均为空，CSP 警告已消失。

## Fixed during QA

1. Electron 控制台提示 Renderer 未配置安全 CSP。已在生产入口加入限制脚本、图片、连接、对象与表单来源的 Content Security Policy，并保留 Naive UI 所需的内联样式权限。
2. 收起右栏曾会销毁组件本地草稿，导致界面恢复旧稿而发送仍可能读取隐藏新稿。草稿状态已提升为 App 级逐资源状态，收起 / 展开与资源切换后保持一致。
3. 技能 / 素材浏览原本会和主创作上下文共用一个选择状态。现已拆分浏览资源与主创作资源，技能 / 素材不会被静默附加。

## Evidence

- [Pi/Faux completed state](screenshots/faux-completed.png)
- [Live draft restored after collapsing](screenshots/live-draft-restored.png)
- [Skill browse without attachment](screenshots/skill-browse-not-attached.png)
- [New conversation empty state](screenshots/new-conversation-empty.png)
- [Final CSP-clean production build](screenshots/final-csp-clean.png)
