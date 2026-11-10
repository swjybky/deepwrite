/** Runs in the real renderer against the open entry dialog. */
export async function verifyLibraryEntryDialog(
  form: HTMLFormElement,
  domain: "material" | "skill"
) {
  if (/创作类型/.test(form.textContent ?? ""))
    throw new Error("Entry dialog still asks for a writing type.");
  const root = document.documentElement;
  const previousStyle = root.style.cssText;
  const previousTheme = root.dataset.theme;
  async function liveForm() {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      document
        .querySelector<HTMLButtonElement>(".startup-alert-close")
        ?.click();
      const current = document.querySelector<HTMLFormElement>(
        ".catalog-resource-form"
      );
      if (current) return current;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(
      "Entry dialog was not restored after the startup announcement."
    );
  }
  const frame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    for (const scheme of ["light", "dark"]) {
      const dark = scheme === "dark";
      root.dataset.theme = scheme;
      for (const [key, value] of Object.entries({
        "--theme-background": dark ? "#17191c" : "#ffffff",
        "--theme-foreground": dark ? "#f3f4f6" : "#1a1c1f",
        "--theme-line": dark ? "#43464b" : "#dedfdf",
        "--theme-line-soft": dark ? "#32363b" : "#e9e9e7",
        "--accent-contrast": "#ffffff",
        "--surface-main": dark ? "#17191c" : "#ffffff",
        "--surface-raised": dark ? "#24262a" : "#fbfbfa",
        "--text-primary": dark ? "#f3f4f6" : "#1a1c1f",
        "--text-secondary": dark ? "#b5b8bf" : "#60646b",
        "--text-tertiary": dark ? "#9a9da5" : "#767a81"
      }))
        root.style.setProperty(key, value);
      for (const font of [10, 14, 24]) {
        root.style.setProperty("--ui-font-size", `${font}px`);
        root.style.setProperty("--accent", "#8c52c9");
        await frame();
        form = await liveForm();
        const labels = [
          ...form.querySelectorAll<HTMLElement>(".book-resource-name-field")
        ];
        const input =
          form.querySelector<HTMLInputElement>('input[type="text"]')!;
        const inputStyle = getComputedStyle(input);
        if (inputStyle.color === inputStyle.backgroundColor)
          throw new Error(
            `Entry name loses contrast: ${JSON.stringify({ scheme, font, color: inputStyle.color, background: inputStyle.backgroundColor, connected: form.isConnected })}`
          );
        let previousBottom: number | undefined;
        for (const label of labels) {
          const bounds = label.getBoundingClientRect();
          if (previousBottom !== undefined && bounds.top - previousBottom < 16)
            throw new Error("Entry dialog fields have insufficient spacing.");
          previousBottom = bounds.bottom;
          const control = label.querySelector<HTMLElement>(
            'input, [role="combobox"]'
          );
          if (!control) throw new Error("Entry dialog field has no control.");
          const controlBounds = control.getBoundingClientRect();
          if (
            controlBounds.width > form.clientWidth ||
            control.scrollWidth > control.clientWidth + 2
          )
            throw new Error("Entry dialog control overflows.");
          if (
            control.tagName === "INPUT" &&
            control.scrollHeight > control.clientHeight + 2
          )
            throw new Error("Entry name is clipped at configured font size.");
        }
      }
      root.style.setProperty("--ui-font-size", "14px");
      await frame();
      console.log(`DEEPWRITE_LIBRARY_DIALOG_CAPTURE ${domain} ${scheme}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    form = await liveForm();
    const labels = [
      ...form.querySelectorAll<HTMLElement>(".book-resource-name-field")
    ];
    const destination = labels
      .find((label) => label.textContent?.includes("所属库"))
      ?.querySelector<HTMLButtonElement>('[role="combobox"]');
    if (!destination) throw new Error("Destination control is missing.");
    destination.click();
    await frame();
    const options = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]')
    ];
    if (
      !options.some(
        (option) =>
          option.textContent?.includes("整理验收-") &&
          option.textContent.includes("-甲")
      ) ||
      !options.some(
        (option) =>
          option.textContent?.includes("整理验收-") &&
          option.textContent.includes("-乙")
      )
    )
      throw new Error(
        "Legacy script and long libraries are missing from destinations."
      );
    destination.click();
    await frame();
    return form;
  } finally {
    root.style.cssText = previousStyle;
    if (previousTheme) root.dataset.theme = previousTheme;
    else delete root.dataset.theme;
  }
}
