---
name: commit
description: 用户要求提交或推送 DeepWrite 代码时使用：只暂存本次改动，过提交钩子，核对后推送到 origin。改完代码不自动提交。
---

# 提交与推送

只在用户要求时提交或推送。

## 提交

1. **看清范围。** `git status`、`git diff`。工作区常混有其他会话的改动，只用 `git add <文件>` 暂存本次改动；同一文件里混着别人的改动时，按块暂存（导出本次的补丁再 `git apply --cached`），拿不准就问。不用 `git add .`、`git add -A`、`git commit -a`，不用 `stash`、`reset`、`checkout --`、`clean` 动别人的改动。
2. **审暂存区。** `git diff --cached` 里没有真实地址、密钥或凭据；`git diff --cached --check` 干净。
3. **身份。** 提交人固定为 `carswj <wenjia@wenjiadeMacBook-Air.local>`。不符时只用 `git config --local` 修正，不改全局。
4. **提交。** `git commit -m "<type>: <说明>"`。`pre-commit` 钩子会对暂存区跑 `check changed --staged`，失败按 [verify](../verify/SKILL.md) 修，不用 `--no-verify`。不加 `Co-authored-by`、`Signed-off-by` 等署名尾注，除非用户要求。
5. **核对。** `git show --stat HEAD` 只含本次的文件。

## 推送

1. **分支。** `tavern` 分支及含酒馆预设代码的提交一律不推（见 `AGENTS.md`），发现即停。
2. **范围。** `git fetch origin` 后，`git log origin/<分支>..HEAD` 只能是本次要推的提交，且能快进；否则停下问用户。禁止强推。
3. **推送并核对。** `git push origin <分支>`，之后 `git rev-parse origin/<分支>` 应等于本地 `HEAD`。网络失败先核对远端 SHA 再重试。
4. 推 `main` 会触发 CI `Verify`。回复里给出 `gh run list --workflow verify.yml --limit 1` 的链接；用户要求时再等结果。
