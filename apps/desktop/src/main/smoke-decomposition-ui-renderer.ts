import type { DeepWriteApi } from "@deepwrite/contracts";

/** Runs only in the disposable smoke Renderer, exercising the actual Vue page. */
export async function decompositionUiStep(
  step: "setup" | "progress" | "registry" | "modal",
  theme: "light" | "dark",
  fontSize: number
) {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 40));
  const ensure = (condition: unknown, reason: string) => {
    if (!condition) throw new Error(`Decomposition UI: ${reason}`);
  };
  async function until<T>(
    read: () => T,
    reason: string
  ): Promise<NonNullable<T>> {
    const deadline = Date.now() + 8000;
    const feedback = new Set<string>();
    while (Date.now() < deadline) {
      document.querySelectorAll(".toast-message__content").forEach((node) => {
        if (node.textContent?.trim()) feedback.add(node.textContent.trim());
      });
      document
        .querySelector<HTMLButtonElement>(".startup-alert-close")
        ?.click();
      const value = read();
      if (value) return value as NonNullable<T>;
      await pause();
    }
    throw new Error(
      `Decomposition UI timeout: ${reason}${feedback.size ? ` (${[...feedback].join("; ")})` : ""}`
    );
  }
  async function click(selector: string) {
    const button = await until(() => {
      const node = document.querySelector<HTMLButtonElement>(selector);
      return node && !node.disabled ? node : null;
    }, selector);
    button.scrollIntoView({ block: "center" });
    button.click();
    await pause();
  }
  async function button(text: string) {
    const selected = await until(
      () =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            ".analysis-workbench button, .analysis-preset-modal button"
          )
        ].find((node) => node.textContent?.trim() === text && !node.disabled),
      text
    );
    selected.scrollIntoView({ block: "center" });
    selected.click();
    await pause();
  }
  async function option(text: string) {
    const selected = await until(
      () =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            ".popup-select-option"
          )
        ].find((node) => node.textContent?.includes(text)),
      text
    );
    selected.click();
    await until(
      () => !document.querySelector(".popup-select-menu"),
      "menu closed"
    );
  }
  if (!document.querySelector(".settings-page")) {
    if (!document.querySelector("#account-menu"))
      await click(".account-identity-button");
    await click('#account-menu button[role="menuitem"]:first-child');
  }
  const appearanceTab = await until(
    () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(".settings-nav button")
      ].find((node) => node.textContent?.trim() === "外观"),
    "appearance tab"
  );
  appearanceTab.click();
  await until(() => {
    const form = document.querySelector<HTMLFieldSetElement>(
      ".appearance-settings-content"
    );
    return form && !form.disabled;
  }, "appearance ready");
  const mode = await until(
    () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".theme-mode-grid button"
        )
      ].find(
        (node) =>
          node.textContent?.trim() === (theme === "dark" ? "深色" : "浅色")
      ),
    "appearance mode"
  );
  mode.click();
  const background = theme === "dark" ? "#151C25" : "#FFF8EF";
  const foreground = theme === "dark" ? "#EDF4FF" : "#271E16";
  for (const [label, value] of [
    ["UI 字号（像素）", String(fontSize)],
    ["输入强调色", "#9057FF"],
    ["输入背景色", background],
    ["输入前景色", foreground]
  ]) {
    const input = await until(
      () =>
        document.querySelector<HTMLInputElement>(
          `input[aria-label="${label}"]`
        ),
      label!
    );
    input.value = value!;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await until(
    () =>
      document.documentElement.dataset.theme === theme &&
      getComputedStyle(document.documentElement)
        .getPropertyValue("--ui-font-size")
        .trim() === `${fontSize}px` &&
      getComputedStyle(document.documentElement)
        .getPropertyValue("--accent")
        .trim()
        .toUpperCase() === "#9057FF" &&
      getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-background")
        .trim() === background &&
      getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-foreground")
        .trim() === foreground,
    "live appearance"
  );
  await click(".settings-back");
  if (
    !document.querySelector('.analysis-workbench[aria-label="长篇整书拆解"]')
  ) {
    const more = await until(
      () => document.querySelector<HTMLButtonElement>('[data-nav-id="more"]'),
      "more features"
    );
    if (more.getAttribute("aria-expanded") !== "true") more.click();
    await click('[data-feature-id="long-book-decomposition"]');
    await until(
      () =>
        document.querySelector(
          '.analysis-workbench[aria-label="长篇整书拆解"]'
        ),
      "decomposition page"
    );
  }

  if (step === "setup") {
    await api.models.save({
      defaultModelId: "decomposition_smoke_model",
      models: [
        {
          id: "decomposition_smoke_model",
          label: "Faux 整书拆解",
          provider: "decomposition-smoke",
          modelId: "faux",
          api: "openai-completions",
          baseUrl: "https://example.test/v1",
          apiKey: "invalid-smoke-placeholder",
          reasoning: false,
          defaultThinkingLevel: "off",
          thinkingLevelOptions: ["low"],
          temperatureOptions: [0.1, 0.7, 1],
          contextWindow: 128_000,
          maxTokens: 8192
        }
      ]
    });
    await click('.popup-select-trigger[aria-label="选择已导入长篇"]');
    await option("冒烟自写样书");
    await button("查看与校正");
    await until(
      () => document.querySelector(".chapter-editor"),
      "source editor"
    );
    await click('.analysis-source-summary-row button[aria-expanded="true"]');
    await button("确认章节与范围");
    await until(
      () => document.querySelector(".decomposition-range .is-success"),
      "source confirmed"
    );
    await button("方案管理");
    await click(".analysis-preset-modal .preset-summary");
    await until(
      () =>
        document.querySelector(".analysis-preset-modal .profile-editor input"),
      "profile editor"
    );
    await button("保存");
    await until(
      () => !document.querySelector(".analysis-preset-modal"),
      "profile saved"
    );
  } else if (step === "progress") {
    await click('.popup-select-trigger[aria-label="已保存任务"]');
    await option("素材模式");
    await until(
      () => document.querySelector('[role="progressbar"]'),
      "saved progress"
    );
    const labels = [
      ...document.querySelectorAll(
        ".decomposition-table-scroll tbody td:first-child"
      )
    ].map((node) => node.textContent ?? "");
    ensure(
      labels.length > 10 &&
        labels.every(
          (label) => !/^(?:reading:|chunk:|registry:|plot:)/u.test(label.trim())
        ),
      "unit titles are not readable"
    );
    const targetJob = (await api.longBookDecomposition.listJobs()).find(
      (job) => job.mode === "materials" && job.phase === "done"
    );
    ensure(targetJob?.target?.kind === "material-group", "material target");
    const target = targetJob!.target!;
    if (target.kind !== "material-group") throw new Error("material target");
    await button("打开写入目标");
    await until(
      () =>
        !document.querySelector(".analysis-workbench") &&
        [
          ...document.querySelectorAll<HTMLElement>(".tree-row.is-selected")
        ].some((node) =>
          Object.values(target.libraryIds).some(
            (id) =>
              node.dataset.resourceId ===
              `catalog:material-overview:${encodeURIComponent(id)}`
          )
        ),
      "material target overview opened"
    );
    if (
      document
        .querySelector('[data-nav-id="more"]')
        ?.getAttribute("aria-expanded") !== "true"
    )
      await click('[data-nav-id="more"]');
    await click('[data-feature-id="long-book-decomposition"]');
    await until(
      () => document.querySelector('[role="progressbar"]'),
      "return to decomposition progress"
    );
  } else if (step === "registry") {
    const jobs = await api.longBookDecomposition.listJobs();
    if (
      !jobs.some(
        (job) =>
          job.targetSelection.action === "create" &&
          job.targetSelection.title === "冒烟名册校对"
      )
    ) {
      const reusable = jobs.find(
        (job) => job.mode === "continuation" && job.phase === "done"
      )!;
      const source = await api.longBookAnalysis.sources.load(
        reusable.source.sourceId
      );
      const confirmation = await api.longBookAnalysis.sources.confirm({
        sourceId: source.id,
        sourceRevision: source.revision!,
        fingerprint: source.fingerprint!,
        range: reusable.source.range
      });
      const created = await api.longBookDecomposition.createJob({
        mode: "continuation",
        confirmation,
        profileId: reusable.profile.id,
        targetSelection: {
          action: "create",
          kind: "long",
          title: "冒烟名册校对"
        },
        models: {
          reading: reusable.models.reading,
          integration: reusable.models.integration
        },
        autoContinue: false,
        maxConcurrency: 5,
        reuseJobId: reusable.id
      });
      const paused = await api.longBookDecomposition.control({
        jobId: created.id,
        action: "advance"
      });
      ensure(
        paused?.phase === "registry_review",
        "reused registry did not pause for confirmation"
      );
    }
    await click(".analysis-refresh-button");
    await click('.popup-select-trigger[aria-label="已保存任务"]');
    await option("冒烟名册校对");
    await until(
      () => document.querySelector(".decomposition-registry"),
      "registry editor"
    );
    await click(".decomposition-registry .popup-select-trigger");
    const menu = await until(
      () => document.querySelector<HTMLElement>(".popup-select-menu"),
      "registry tier menu"
    );
    const rectangle = menu.getBoundingClientRect();
    ensure(
      rectangle.top >= 0 &&
        rectangle.bottom <= innerHeight + 1 &&
        Number(getComputedStyle(menu).zIndex) >= 1000,
      "popup clipped or below modal"
    );
    await option("主角");
    const registryJob = (await api.longBookDecomposition.listJobs()).find(
      (job) =>
        job.targetSelection.action === "create" &&
        job.targetSelection.title === "冒烟名册校对"
    )!;
    const before = await api.longBookDecomposition.getRegistry(registryJob.id);
    await button("保存名册");
    await until(
      () =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            ".decomposition-registry button"
          )
        ].some(
          (node) => node.textContent?.trim() === "保存名册" && !node.disabled
        ),
      "registry saved"
    );
    const after = await api.longBookDecomposition.getRegistry(registryJob.id);
    ensure(
      after.version === before.version + 1 &&
        after.characters[0]?.tier === "protagonist",
      "registry edit was not persisted"
    );
    document
      .querySelector(".decomposition-registry")
      ?.scrollIntoView({ block: "start" });
  } else {
    await button("删除任务记录");
    const modal = await until(
      () =>
        document.querySelector<HTMLElement>(
          '.analysis-refresh-dialog[role="alertdialog"]'
        ),
      "delete dialog"
    );
    ensure(
      getComputedStyle(modal).color !== getComputedStyle(modal).backgroundColor,
      "modal contrast"
    );
    ensure(
      modal.getBoundingClientRect().bottom <= innerHeight + 1,
      "modal clipped"
    );
    ensure(
      parseFloat(getComputedStyle(modal).paddingTop) >= 18 &&
        parseFloat(getComputedStyle(modal).borderRadius) >= 8,
      "modal container styling"
    );
  }
  const page = document.querySelector<HTMLElement>(".analysis-workbench")!;
  if (step === "setup" || step === "progress") page.scrollTop = 0;
  await pause();
  ensure(
    page.clientWidth > 0 && page.scrollWidth <= page.clientWidth + 2,
    "horizontal page overflow"
  );
  ensure(
    document.documentElement.scrollWidth <= innerWidth + 2,
    "window overflow"
  );
  const primary = page.querySelector<HTMLElement>(".analysis-primary-button");
  if (primary)
    ensure(
      getComputedStyle(primary).color !==
        getComputedStyle(primary).backgroundColor,
      "primary contrast"
    );
  // Read only the public model catalog; this does not send source text to a model.
  if (step === "modal") await api.models.refreshFree().catch(() => undefined);
  const settings = await api.models.list();
  const freeModel = settings.deepwriteFreeModels?.find(
    (model) =>
      model.hasApiKey &&
      model.status !== 1 &&
      (model.contextWindow === undefined || model.contextWindow >= 16_000)
  );
  return {
    step,
    theme,
    background,
    foreground,
    fontSize,
    viewport: { width: innerWidth, height: innerHeight },
    status: "ok",
    ...(freeModel
      ? {
          trialModel: {
            id: freeModel.id,
            label: freeModel.label,
            provider: freeModel.provider
          }
        }
      : {})
  };
}
