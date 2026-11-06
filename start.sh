#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname "${BASH_SOURCE[0]}")"

launch_platform="$(uname -s)"
case "$launch_platform" in
  Linux | Darwin) ;;
  *)
    printf '不支持的系统：%s（仅支持 Linux 和 macOS）\n' "$launch_platform" >&2
    exit 1
    ;;
esac

for required_command in node pnpm; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf '找不到 %s，请先安装并加入 PATH。\n' "$required_command" >&2
    exit 1
  fi
done

node --input-type=module <<'JS'
import { assertElectronLaunchAllowed } from "./tools/electron-launch-environment.mjs";
assertElectronLaunchAllowed();
JS

case "$launch_platform" in
  Linux)
    # 搜狗/Fcitx 4 通过 X11/XWayland 接入 Electron 的输入法。
    export GTK_IM_MODULE=fcitx
    export QT_IM_MODULE=fcitx
    export XMODIFIERS=@im=fcitx
    printf '启动 DeepWrite（Linux，X11/XWayland 搜狗兼容模式）\n'
    exec pnpm --filter @deepwrite/desktop dev "$@" -- --ozone-platform=x11
    ;;
  Darwin)
    printf '启动 DeepWrite（macOS，默认模式）\n'
    exec pnpm --filter @deepwrite/desktop dev "$@"
    ;;
esac
