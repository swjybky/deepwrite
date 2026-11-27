import type { BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  APPEARANCE_FONT_SIZE_LIMITS,
  type DeepWriteApi
} from "@deepwrite/contracts";

type StorageUiVariant = "light" | "dark" | "custom" | "large";

/** Exercise the actual settings controls; no Vue state or CSS is injected. */
async function storageUiInRenderer(input: {
  variant: StorageUiVariant;
  fontSize: number;
}) {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const pause = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  const ensure = (condition: unknown, message: string): void => {
    if (!condition) throw new Error(`Storage UI smoke: ${message}`);
  };
  async function until<T>(
    read: () => T,
    label: string
  ): Promise<NonNullable<T>> {
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      document
        .querySelector<HTMLButtonElement>(".startup-alert-close")
        ?.click();
      const value = read();
      if (value) return value as NonNullable<T>;
      await pause(30);
    }
    throw new Error(`Storage UI smoke timed out: ${label}`);
  }
  const selector = <T extends Element = HTMLElement>(value: string) =>
    document.querySelector<T>(value);
  async function clickText(root: string, text: string): Promise<void> {
    const button = await until(
      () =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(`${root} button`)
        ].find((node) => !node.disabled && node.textContent?.trim() === text),
      text
    );
    button.scrollIntoView({ block: "center", inline: "nearest" });
    button.click();
  }
  async function setInput(label: string, value: string): Promise<void> {
    const field = await until(
      () => selector<HTMLInputElement>(`input[aria-label="${label}"]`),
      label
    );
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await pause(30);
  }

  if (!selector(".settings-page")) {
    if (!selector("#account-menu")) {
      const profile = await until(
        () => selector<HTMLButtonElement>(".account-identity-button"),
        "account menu entry"
      );
      profile.click();
    }
    const button = await until(
      () =>
        selector<HTMLButtonElement>(
          '#account-menu button[role="menuitem"]:not(.account-sign-in-button)'
        ),
      "settings entry"
    );
    button.click();
  }
  if (input.variant === "light") {
    await clickText(".settings-nav", "常规");
    ensure(
      !selector(".storage-card"),
      "storage still appears in general settings"
    );
    const search = selector<HTMLInputElement>(".settings-search input")!;
    search.value = "存储";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => {
      const categories = document.querySelectorAll(".settings-category");
      return (
        categories.length === 1 &&
        categories[0]?.textContent?.trim() === "存储与备份"
      );
    }, "storage search points to storage settings");
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  }
  await clickText(".settings-nav", "外观");
  await until(() => {
    const form = selector<HTMLFieldSetElement>(".appearance-settings-content");
    return form && !form.disabled;
  }, "appearance loaded");
  const scheme = input.variant === "dark" ? "dark" : "light";
  await clickText(".theme-mode-grid", scheme === "dark" ? "深色" : "浅色");
  await setInput("UI 字号（像素）", String(input.fontSize));
  if (input.variant === "custom" || input.variant === "large")
    await setInput("输入强调色", "#A855F7");
  await until(
    () =>
      document.documentElement.dataset.theme === scheme &&
      getComputedStyle(document.documentElement)
        .getPropertyValue("--ui-font-size")
        .trim() === `${input.fontSize}px`,
    "theme and UI size applied"
  );
  if (input.variant === "custom" || input.variant === "large")
    ensure(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--accent")
        .trim()
        .toUpperCase() === "#A855F7",
      "custom accent did not apply"
    );

  await clickText(".settings-nav", "存储与备份");
  await until(
    () =>
      Boolean(selector(".storage-backup-card")) &&
      document.querySelectorAll(".storage-card").length === 2 &&
      selector('[aria-labelledby="storage-settings-title"]')?.getAttribute(
        "aria-busy"
      ) === "false",
    "two loaded storage cards"
  );
  ensure(
    [...document.querySelectorAll(".storage-card h3")]
      .map((node) => node.textContent?.trim())
      .join(",") === "工作目录,用户数据目录",
    "workspace folder must appear above user data"
  );
  let snapshot = await api.storageSettings!.get();
  if (input.variant === "light") {
    const reset = selector<HTMLButtonElement>(
      'button[aria-label="恢复工作目录默认位置"]'
    );
    ensure(
      reset && !reset.disabled,
      "workspace reset action is missing or disabled"
    );
    reset!.click();
    await until(
      () =>
        selector('.storage-card[aria-label="工作目录"] dd')?.textContent ===
        snapshot.workspace.defaultPath,
      "workspace reset through the storage panel"
    );
    snapshot = await api.storageSettings!.get();
    ensure(snapshot.workspace.isDefault, "workspace reset did not persist");
    ensure(
      (await api.catalog.snapshot()).books.some(
        (book) =>
          book.title === "Storage smoke book" &&
          book.documents[0]?.content ===
            "Existing work stays in its original workspace."
      ),
      "workspace reset changed an existing book"
    );
    await clickText(".settings-nav", "常规");
    ensure(
      !selector(".storage-card"),
      "storage appears in general after reset"
    );
    await clickText(".settings-nav", "存储与备份");
    await until(
      () =>
        selector('[aria-labelledby="storage-settings-title"]')?.getAttribute(
          "aria-busy"
        ) === "false",
      "storage panel reopened"
    );
  }
  for (const [label, location] of [
    ["用户数据目录", snapshot.userData],
    ["工作目录", snapshot.workspace]
  ] as const) {
    const card = selector(`.storage-card[aria-label="${label}"]`);
    ensure(card, `${label} card missing`);
    const values = [...card!.querySelectorAll("dd")].map(
      (node) => node.textContent
    );
    ensure(
      values.length === 1 && values[0] === location.path,
      `${label} must only show its current path`
    );
    ensure(
      card!.querySelectorAll(".storage-actions button").length === 3,
      `${label} actions missing`
    );
  }
  const title = selector("#storage-settings-title")!;
  for (const toast of document.querySelectorAll<HTMLButtonElement>(
    ".toast-message"
  ))
    toast.click();
  await until(
    () => !selector(".toast-message"),
    "feedback dismissed before capture"
  );
  title.scrollIntoView({ block: "start", inline: "nearest" });
  await pause(150);
  const containers = [
    ...document.querySelectorAll<HTMLElement>(
      ".settings-page, .settings-content, .storage-card, .storage-paths, .storage-actions"
    )
  ];
  for (const node of containers) {
    ensure(
      node.scrollWidth <= node.clientWidth + 1,
      `${node.className} overflows horizontally`
    );
    ensure(
      node.getBoundingClientRect().right <= window.innerWidth + 1,
      `${node.className} exceeds viewport`
    );
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".storage-actions button"
  )) {
    ensure(
      button.scrollHeight <= button.clientHeight + 1,
      "storage action text is clipped"
    );
  }
  return {
    variant: input.variant,
    fontSize: input.fontSize,
    width: window.innerWidth,
    horizontalOverflow: false
  };
}

export async function runStorageUiSmoke(window: BrowserWindow) {
  if (process.env.DEEPWRITE_STORAGE_SMOKE !== "seed")
    throw new Error("Storage UI smoke requires the isolated seed profile.");
  const screenshots: string[] = [];
  const directory = process.platform === "darwin" ? "/private/tmp" : tmpdir();
  const capture = async (name: string) => {
    const path = join(directory, `deepwrite-storage-settings-${name}.png`);
    await writeFile(path, (await window.capturePage()).toPNG());
    screenshots.push(path);
  };
  window.showInactive();
  for (const variant of ["light", "dark", "custom", "large"] as const) {
    window.setSize(
      variant === "large" ? 1120 : 1200,
      variant === "large" ? 700 : 1000
    );
    await window.webContents.executeJavaScript(
      `(${storageUiInRenderer.toString()})(${JSON.stringify({
        variant,
        fontSize:
          variant === "large" ? APPEARANCE_FONT_SIZE_LIMITS.uiFontSize.max : 14
      })})`,
      true
    );
    await capture(variant);
    if (variant === "large") {
      for (const [kind, label] of [
        ["user-data", "用户数据目录"],
        ["workspace", "工作目录"]
      ]) {
        await window.webContents.executeJavaScript(
          `document.querySelector('.storage-card[aria-label="${label}"] .storage-actions').scrollIntoView({block:'end'});`
        );
        await capture(`large-${kind}-actions`);
      }
    }
  }
  // Debounced theme persistence must complete before the profile is migrated.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return {
    status: "ok",
    cards: 2,
    originalWorkspaceEntry: true,
    themes: 3,
    maxUiFontSize: APPEARANCE_FONT_SIZE_LIMITS.uiFontSize.max,
    screenshots
  };
}
