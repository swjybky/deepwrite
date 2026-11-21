import type {
  AppLanguage,
  DeepWriteApi,
  MoreFeaturesSettings
} from "@deepwrite/contracts";

export interface I18nSmokeFixture {
  originalLanguage: AppLanguage;
  originalMoreFeatures: MoreFeaturesSettings;
  bookId: string;
  documentId: string;
  snapshot: string;
  manuscript: string;
  settingsCount: number;
  featuresCount: number;
}

/** Serialized into the isolated smoke Renderer; all settings use the real UI. */
export async function i18nSmokeInRenderer(
  restored?: I18nSmokeFixture
): Promise<I18nSmokeFixture> {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const pause = (ms = 30) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  const ensure = (value: unknown, reason: string) => {
    if (!value) throw new Error(`Language smoke: ${reason}`);
  };
  async function until<T>(
    read: () => T,
    reason: string
  ): Promise<NonNullable<T>> {
    const end = Date.now() + 5_000;
    while (Date.now() < end) {
      document
        .querySelector<HTMLButtonElement>(".startup-alert-close")
        ?.click();
      const value = read();
      if (value) return value as NonNullable<T>;
      await pause();
    }
    throw new Error(`Language smoke timed out: ${reason}`);
  }
  const select = <T extends Element = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector);
  async function click(selector: string) {
    const button = await until(
      () => select<HTMLButtonElement>(selector),
      selector
    );
    ensure(!button.disabled, `disabled control ${selector}`);
    button.scrollIntoView({ block: "center" });
    button.click();
    await pause();
  }
  async function settingsCategory(label: string) {
    const button = await until(
      () =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(".settings-category")
        ].find((node) => node.textContent?.trim() === label),
      label
    );
    button.click();
    await until(
      () => select(".settings-title")?.textContent?.trim() === label,
      label
    );
    await pause();
  }
  async function openGeneral() {
    if (!select(".settings-page")) {
      if (!select("#account-menu")) await click(".account-identity-button");
      await click(
        '#account-menu button[role="menuitem"]:not(.account-sign-in-button)'
      );
    }
    await settingsCategory(
      document.documentElement.lang === "en-US" ? "General" : "常规"
    );
  }
  async function language(target: "zh-CN" | "en-US") {
    await openGeneral();
    await click(
      '.popup-select-trigger[aria-label="选择应用语言"], .popup-select-trigger[aria-label="Choose application language"]'
    );
    const option = await until(
      () =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            ".popup-select-option"
          )
        ].find(
          (node) =>
            node.textContent?.trim() ===
            (target === "en-US" ? "English" : "简体中文")
        ),
      target
    );
    option.click();
    await until(() => document.documentElement.lang === target, "root locale");
    await until(() => !select(".popup-select-menu"), "language menu closed");
    const deadline = Date.now() + 5_000;
    while ((await api.generalSettings.list()).settings.language !== target) {
      ensure(Date.now() < deadline, "language did not persist");
      await pause();
    }
  }
  function layout() {
    const page = select(".settings-page");
    ensure(page && page.clientWidth > 0, "settings not visible");
    ensure(
      document.documentElement.scrollWidth <= window.innerWidth + 2,
      "horizontal page overflow"
    );
    const title = select(".settings-title")!;
    ensure(
      parseFloat(getComputedStyle(title).fontSize) > 10,
      "invalid UI font size"
    );
    for (const button of document.querySelectorAll<HTMLElement>(
      ".settings-category"
    )) {
      ensure(
        button.scrollHeight <= button.clientHeight + 2,
        "clipped settings category"
      );
    }
  }
  const signature = async () => {
    const snapshot = await api.catalog.snapshot();
    return JSON.stringify({
      books: snapshot.books,
      materials: snapshot.materials,
      skills: snapshot.skills
    });
  };
  const manuscriptSignature = async (bookId: string, documentId: string) =>
    JSON.stringify(
      await api.catalog.readDocument({
        target: "document",
        projectId: bookId,
        documentId
      })
    );

  if (restored) {
    await until(
      () => document.documentElement.lang === "en-US",
      "startup restored English"
    );
    ensure(
      (await api.generalSettings.list()).settings.language === "en-US",
      "saved language changed on reload"
    );
    ensure(
      (await signature()) === restored.snapshot,
      "reload changed manuscript or names"
    );
    ensure(
      (await manuscriptSignature(restored.bookId, restored.documentId)) ===
        restored.manuscript,
      "reload changed saved manuscript"
    );
    await openGeneral();
    ensure(
      select(".settings-title")?.textContent === "General",
      "restored settings are not English"
    );
    layout();
    await api.catalog.deleteBook(restored.bookId);
    const current = await api.generalSettings.list();
    const reset = await api.generalSettings.save({
      ...current.settings,
      language: restored.originalLanguage,
      moreFeatures: restored.originalMoreFeatures
    });
    ensure(
      reset.settings.language === restored.originalLanguage,
      "original language was not restored"
    );
    return restored;
  }

  const { language: originalLanguage, moreFeatures: originalMoreFeatures } = (
    await api.generalSettings.list()
  ).settings;
  const book = await api.catalog.createShortBook({
    title: "语言测试原名",
    genre: "其他"
  });
  if (!book?.documents[0])
    throw new Error("Language smoke could not create its fixture");
  const documentId = book.documents[0].id;
  await api.catalog.saveDocument({
    bookId: book.id,
    documentId,
    title: "保留中文文件名",
    content: "用户正文保持中文。English remains user content.\n第二段。"
  });
  const snapshot = await signature();
  const manuscript = await manuscriptSignature(book.id, documentId);
  select<HTMLButtonElement>(
    ".chat-assistant-header-actions button:last-child"
  )?.click();
  await language("zh-CN");
  await language("en-US");
  ensure(
    select(".settings-title")?.textContent === "General",
    "general title did not switch"
  );
  const settings = [...document.querySelectorAll(".settings-category")].map(
    (node) => node.textContent!.trim()
  );
  ensure(settings.length >= 14, "settings categories missing");
  ensure(
    settings.includes("Official site models"),
    "official-site settings missing"
  );
  ensure(
    !settings.some((label) => /legacy official/iu.test(label)),
    "retired official-site settings are still visible"
  );
  for (const method of [
    "refreshOfficial",
    "queryOfficialBalance",
    "saveOfficialToken",
    "clearOfficialToken",
    "setOfficialModelEnabled"
  ]) {
    ensure(!(method in api.models), `retired model API exposed: ${method}`);
  }
  ensure(
    typeof api.models.saveSiteOfficialToken === "function" &&
      typeof api.models.querySiteOfficialQuota === "function",
    "official-site model API missing"
  );
  ensure(
    settings.every((text) => !/\p{Script=Han}/u.test(text)),
    "Chinese settings category in English mode"
  );
  for (const label of settings) {
    await settingsCategory(label);
    if (label === "Official site models") {
      await until(() => select(".site-models-panel"), "official-site panel");
    }
    layout();
  }
  await settingsCategory("More features");
  const featureSettings = await until(
    () => select(".more-features-settings"),
    "feature visibility settings"
  );
  ensure(
    !featureSettings.querySelector('[data-more-feature-id="cloud-backup"]'),
    "cloud backup is still configurable"
  );
  const toggles = featureSettings.querySelectorAll<HTMLInputElement>(
    '[data-more-feature-id] input[role="switch"]'
  );
  for (const toggle of toggles) {
    if (toggle.checked) continue;
    toggle.click();
    await until(
      () => toggle.getAttribute("aria-checked") === "true",
      toggle.getAttribute("aria-label") ?? "feature visibility"
    );
  }
  await click(".settings-back");
  const more = await until(
    () => select<HTMLButtonElement>('[data-nav-id="more"]'),
    "more features"
  );
  if (more.getAttribute("aria-expanded") !== "true") more.click();
  await until(() => select("[data-feature-id]"), "feature menu");
  const features = [
    ...document.querySelectorAll<HTMLElement>("[data-feature-id]")
  ];
  ensure(
    !select('[data-feature-id="cloud-backup"]'),
    "cloud backup is still in the feature menu"
  );
  ensure(
    features.length >= 9 && features.length === toggles.length,
    `expected ${toggles.length} more features, found ${features.length}`
  );
  ensure(
    features.every((node) => !/\p{Script=Han}/u.test(node.textContent ?? "")),
    "Chinese feature label in English mode"
  );
  for (const [id, title] of [
    ["revision-analysis", "Revision analysis"],
    ["short-book-analysis", "Short story analysis"],
    ["long-book-analysis", "Novel analysis"],
    ["style-comparison", "Style comparison"],
    ["device-sync", "Device sync"],
    ["skill-marketplace", "Marketplace"]
  ]) {
    if (!select(`[data-feature-id="${id}"]`)) more.click();
    await click(`[data-feature-id="${id}"]`);
    if (id === "skill-marketplace") {
      await until(
        () => select(".marketplace-login-dialog .auth-form"),
        `${id} sign-in prompt`
      );
      ensure(
        select(".marketplace-login-dialog")?.getAttribute("aria-label") ===
          "Sign in to DeepWrite",
        `${id} English sign-in title`
      );
      await click(".marketplace-login-dialog .dialog-close");
      await until(
        () => !select(".marketplace-login-dialog"),
        `${id} sign-in prompt closed`
      );
      continue;
    }
    await until(
      () =>
        [...document.querySelectorAll("h1")].some(
          (node) => node.textContent?.trim() === title
        ),
      `${id} English heading`
    );
  }
  await language("zh-CN");
  ensure(
    select(".settings-title")?.textContent === "常规",
    "Chinese did not restore"
  );
  await language("en-US");
  ensure(
    (await signature()) === snapshot,
    "switching language changed manuscript or names"
  );
  ensure(
    (await manuscriptSignature(book.id, documentId)) === manuscript,
    "switching language changed saved manuscript"
  );
  layout();
  return {
    originalLanguage,
    originalMoreFeatures,
    bookId: book.id,
    documentId,
    snapshot,
    manuscript,
    settingsCount: settings.length,
    featuresCount: features.length
  };
}
