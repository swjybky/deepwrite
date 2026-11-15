# R2 版本指针的弱 ETag

## 症状

附件上传和 HEAD 校验通过，但激活时报“更新 R2 版本指针失败（HTTP 412）”。GET 返回的 ETag 带 `W/` 前缀。

## 根因

响应压缩可将对象的强 ETag 转成弱 ETag。`If-Match` 使用强比较，弱 ETag 无法满足条件写入；小型健康检查未压缩时不能复现。

## 处理

`tools/publish-r2-release.mjs` 的 `createR2Client` 请求 `Accept-Encoding: identity`，读取原始表示的强 ETag，再由 `activateR2Release` 原样用于条件写入。

不要直接删除 `W/`，也不要取消 `If-Match`。核对真实响应后重跑同步；已核验的附件会跳过上传。

## 预防

`tools/publish-r2-release.test.mjs` 模拟压缩 GET 返回弱 ETag、弱条件写入返回 412，验证激活请求保持原始表示和并发保护。
