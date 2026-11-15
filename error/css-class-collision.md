# 全局 CSS 类名冲突

返回 [ERROR.md](../ERROR.md)。

**症状：**组件 scoped 样式不生效，元素莫名透明或隐藏（如树形箭头消失）。

**根因：**`renderer/src/styles.css` 有全局通用类（`.tree-chevron`、`.tree-row`、`section-*` 等），新组件用了同名类，被全局规则覆盖。

**处理：**新类名带领域前缀（如 `skill-picker-row`）；排查时在 Browser 窗格查看元素的生效规则来源。

**预防：**新组件不用 `tree-*`、`section-*` 等通用前缀，见 [DESIGN.md](../DESIGN.md)“样式代码放哪里”。
