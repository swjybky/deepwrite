interface StorageCommandLine {
  hasSwitch(name: string): boolean;
  appendSwitch(name: string, value: string): void;
}

/** Configure before app readiness, when Chromium selects its encryption backend. */
export function configureLinuxSecretStorage(
  commandLine: StorageCommandLine,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (platform !== "linux" || commandLine.hasSwitch("password-store")) return;

  // Keep Chromium's native KWallet selection for KDE/LXQt sessions. Other Linux
  // sessions use the standard Secret Service API, including standalone Wayland
  // compositors such as niri and sway that Chromium does not recognise.
  const desktops = (env.XDG_CURRENT_DESKTOP ?? "").split(":");
  if (
    env.KDE_FULL_SESSION === "true" ||
    desktops.some((desktop) => /^(kde|lxqt)$/iu.test(desktop.trim()))
  ) {
    return;
  }
  // Missing or locked keyrings must still fail securely. Never enable
  // basic_text or setUsePlainTextEncryption as a fallback.
  commandLine.appendSwitch("password-store", "gnome-libsecret");
}
