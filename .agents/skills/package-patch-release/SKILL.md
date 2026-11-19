---
name: package-patch-release
description: 为 DeepWrite 递增补丁版本、清理旧产物并一次打包；按授权发布 GitHub Release，发布验证后仅提交推送 update.json。用于打包新版本、提高一小个版本、清理旧包发布或更新发布清单。
---

# 打包补丁版本并按需发布

打包的命令、验证档位、失败处理按 [测试安装包技能](../windows-macos-test-package/SKILL.md)；提交或推送时读 [git-commit](../git-commit/SKILL.md)。默认只交付本地测试包，用户明确要求发布时才走 Release 流程。

本地打包一律加 `--skip-verify`，全量测试交给 CI。改版本号本身不需要测试；用户说过代码已验证、已过一轮时打包前也不补测；发布阶段的任何重试都不再跑测试。

## 边界

- 保留工作树和暂存区已有内容，不还原、覆盖或夹带用户修改；不使用 `git add .`、`git add -A`、`git commit -a`、`git stash`、`git reset`、`git checkout --`、`git clean` 或强推。
- 只改两个 `package.json` 的版本和发布成功后的 `update.json`；阻塞打包的修复按测试安装包技能的失败处理来做，不顺手修无关问题。
- 最终提交只含根目录 `update.json`；版本修改和修复留在工作树。
- 对应 Release 未公开且资产未完整可下载前，不更新、提交或推送 `update.json`。不发布时不创建 tag、Release 或提交。

## 1. 定版本并清理

1. 用一组只读命令查看：Git 状态、两个 `package.json` 的版本、`update.json.version`、`git tag -l 'v*' --sort=-v:refname | head -3`、`ls apps/desktop/release/`。
2. 两个 `package.json` 须为相同三段 SemVer；“提高一小个版本”只递增补丁位一次，用户指定版本优先，须大于当前和 `update.json.version`。已在本轮递增过就沿用，不重复递增；版本不一致又无法判断时问用户。
3. 只在 `apps/desktop/release/` 内删除旧版本或本次会重建的生成物：`DeepWrite-<旧版本>-*`、`mac/`、`mac-arm64/`、`win-unpacked/`、`linux-unpacked/`、`.icon-icns/`、`latest*.yml`、`builder-debug.yml`、`builder-effective-config.yaml`。未知文件保留。
4. 同步修改两个顶层 `version`，暂不改 `update.json`。

## 2. 打包

按测试安装包技能执行**一个**批次。成功后交付本地产物；用户未授权发布就到此结束。

## 3. 发布 GitHub Release（需授权）

1. 检查 `gh auth status` 和 `swjybky/deepwrite` 上的 `v<新版本>`。禁止覆盖既有公开发布；重试先读远端状态，只接续本轮的 Draft，不重复创建或上传。
2. 创建 Draft，标题 `DeepWrite <新版本>`，说明用用户提供的内容或核实过的实际变更，不标 prerelease。只上传本轮成功的资产：Windows 为 EXE、EXE blockmap、`latest.yml`；Mac 为各架构 DMG、ZIP、ZIP blockmap 和最终 `latest-mac.yml`；Linux 按实际清单。
3. 两种 Mac 架构时，`latest-mac.yml` 须同时引用两个 ZIP 及其 SHA-512；缺项保持 Draft，补齐后再发。
4. 用 `gh release view --json assets` 核对名称、数量、非零大小，完整后发布；再读一次确认公开、非 prerelease、下载 URL 可访问。

## 4. 只提交并推送 update.json

1. 只改 `version`、`title`、与 Release 一致的 `releaseNotes`、发布完成时的 Asia/Shanghai ISO 8601 `publishedAt`，以及 `releasePage`（`https://github.com/swjybky/deepwrite/releases/tag/v<新版本>`）。
2. 校验 JSON，版本与两个 `package.json`、tag、`latest*.yml` 一致。用 `git commit --only -m "chore: update release manifest to v<新版本>" -- update.json` 提交；这是只改清单的提交，不跑 `pnpm verify`。
3. `git show --name-only --format= HEAD` 必须只有 `update.json`；`git fetch` 后 `origin/main..HEAD` 只能有这一个提交且可快进，否则停下询问。
4. 推送到用户指定分支，默认 `origin/main`；网络失败先核对远端 SHA 再重试。推送后读远端清单确认生效。
5. 报告版本、产物路径、必要修复、Release URL 和提交 SHA，并说明版本修改仍留在工作树。
