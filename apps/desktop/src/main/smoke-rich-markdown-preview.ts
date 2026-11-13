/** Runs inside the real Renderer, against the same formatted DOM the user edits. */
export async function exerciseRichMarkdownPreview(
  preview: HTMLElement,
  readSaved: () => Promise<string>
) {
  const frame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  async function until(read: () => boolean | Promise<boolean>, reason: string) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await read()) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(
      `Rich preview smoke timed out: ${reason}; ${preview.textContent?.slice(0, 180)}`
    );
  }
  const editor = preview.querySelector<HTMLElement>(
    ".editable-markdown-document"
  )!;
  const image = preview.querySelector<HTMLImageElement>(".markdown-image img")!;
  await image.decode();
  const heading = editor.querySelector<HTMLElement>("h2")!;
  const bold = editor.querySelector<HTMLElement>("strong")!;
  const list = editor.querySelector<HTMLElement>("li p")!;
  const cell = editor.querySelector<HTMLElement>("td:last-child p")!;
  const untouched = editor.lastElementChild!;
  if (!heading || !bold || !list || !cell || !editor.isContentEditable)
    throw new Error(
      "Rich preview fixture must include an editable heading, bold text, list and table."
    );
  if (
    untouched.tagName !== "P" ||
    untouched.textContent ||
    !untouched.previousElementSibling?.matches(".markdown-image")
  )
    throw new Error(
      "There is no editable text position after the final image."
    );
  if (image.closest("figure")?.textContent?.trim())
    throw new Error("Book image preview still displays a filename or caption.");
  function select(node: Node, start: number, end = start) {
    editor.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }
  async function caret(element: HTMLElement, offset: number) {
    select(element.firstChild!, offset);
    await frame();
  }
  const original = await readSaved();
  for (const element of [heading, bold, list, cell]) {
    const html = element.outerHTML;
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const typography = [
      style.fontSize,
      style.fontWeight,
      style.lineHeight
    ].join(";");
    const imageTop = image.getBoundingClientRect().top;
    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: bounds.left + 2,
        clientY: bounds.top + 2
      })
    );
    await caret(element, 1);
    const after = element.getBoundingClientRect();
    const afterStyle = getComputedStyle(element);
    if (
      !element.isConnected ||
      element.outerHTML !== html ||
      preview.querySelector("textarea") ||
      ["left", "top", "width", "height"].some(
        (key) =>
          Math.abs(
            (after[key as keyof DOMRect] as number) -
              (bounds[key as keyof DOMRect] as number)
          ) > 1
      ) ||
      Math.abs(image.getBoundingClientRect().top - imageTop) > 1 ||
      [afterStyle.fontSize, afterStyle.fontWeight, afterStyle.lineHeight].join(
        ";"
      ) !== typography
    )
      throw new Error(
        "Clicking formatted preview content changed its DOM, Markdown format or layout."
      );
  }
  if ((await readSaved()) !== original)
    throw new Error("Selecting preview text wrote changes to disk.");
  await caret(bold, 1);
  const samples: number[] = [];
  async function type(text: string, composing = false) {
    editor.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: composing ? "insertCompositionText" : "insertText",
        data: text,
        isComposing: composing
      })
    );
    if (!document.execCommand("insertText", false, text))
      throw new Error("Native contenteditable input failed.");
    await frame();
  }
  for (const text of ["甲", "乙", "丙", "丁", "戊"]) {
    const started = performance.now();
    await type(text);
    samples.push(performance.now() - started);
    if (
      preview.querySelector(".editable-markdown-document") !== editor ||
      document.activeElement !== editor ||
      !bold.isConnected ||
      !untouched.isConnected ||
      preview.querySelector(".markdown-image img") !== image
    )
      throw new Error(
        "Typing replaced the editor, formatted text, untouched block or image."
      );
  }
  await until(
    async () => (await readSaved()).includes("**粗甲乙丙丁戊体**"),
    "bold edits automatically saved as Markdown"
  );
  const modifier = /Mac/u.test(navigator.platform)
    ? { metaKey: true }
    : { ctrlKey: true };
  editor.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "z",
      code: "KeyZ",
      ...modifier
    })
  );
  await until(
    () => editor.querySelector("strong")?.textContent === "粗体",
    "shared undo"
  );
  if (
    preview.querySelector(".editable-markdown-document") !== editor ||
    preview.querySelector("textarea")
  )
    throw new Error("Undo left the rendered preview.");
  await until(
    async () => (await readSaved()).includes("**粗体**"),
    "undo automatically saved"
  );
  editor.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "z",
      code: "KeyZ",
      shiftKey: true,
      ...modifier
    })
  );
  await until(
    () => editor.querySelector("strong")?.textContent === "粗甲乙丙丁戊体",
    "shared redo"
  );
  for (const [selector, text] of [
    ["h2", "修订"],
    ["li p", "补充"],
    ["td:last-child p", "东侧"]
  ]) {
    const element = editor.querySelector<HTMLElement>(selector!)!;
    await caret(element, element.firstChild!.textContent!.length);
    await type(text!);
  }
  await until(async () => {
    const content = await readSaved();
    return (
      content.includes("## 对齐正文修订") &&
      content.includes("第一项补充") &&
      content.includes("庭院东侧") &&
      content.includes("**粗甲乙丙丁戊体**")
    );
  }, "heading, list and table edits saved with their formatting");
  const paragraph = editor.querySelector<HTMLElement>(":scope > p")!;
  select(paragraph.lastChild!, paragraph.lastChild!.textContent!.length);
  await frame();
  const beforeComposition = await readSaved();
  editor.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true })
  );
  await type("zhong", true);
  await new Promise<void>((resolve) => setTimeout(resolve, 900));
  if ((await readSaved()) !== beforeComposition)
    throw new Error("IME candidate text reached the saved document.");
  const candidate = getSelection()!;
  select(
    candidate.anchorNode!,
    candidate.anchorOffset - 5,
    candidate.anchorOffset
  );
  await type("中文", true);
  editor.dispatchEvent(
    new CompositionEvent("compositionend", { bubbles: true, data: "中文" })
  );
  await until(async () => {
    const content = await readSaved();
    return content.includes("继续。中文") && !content.includes("zhong");
  }, "only the committed IME text saved");
  if (
    !editor.querySelector("h2") ||
    !editor.querySelector("strong") ||
    !editor.querySelector("ul li") ||
    !editor.querySelector("table td")
  )
    throw new Error("Formatted document structure disappeared after editing.");
  editor.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "f",
      code: "KeyF",
      ...modifier
    })
  );
  const findField = () =>
    document.querySelector<HTMLInputElement>(
      ".editor-find-panel input, .long-editor-find-panel input"
    );
  await until(() => Boolean(findField()), "find panel opened from preview");
  const input = findField()!;
  input.value = "庭院东侧";
  input.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: input.value
    })
  );
  await frame();
  await frame();
  if (
    !editor.isConnected ||
    document.activeElement !== input ||
    preview.querySelector("textarea")
  )
    throw new Error(
      "Finding text switched away from preview or stole input focus."
    );
  input.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
  );
  await until(
    () =>
      !findField() &&
      document.activeElement === editor &&
      getSelection()?.toString() === "庭院东侧",
    "find selected the rendered table cell"
  );
  const beforeImageDeletion = await readSaved();
  const footer = editor.lastElementChild!.previousElementSibling!;
  const footerImage = footer.querySelector<HTMLImageElement>("img")!;
  const reference = `![${footerImage.alt}](${(footer as HTMLElement).dataset.imagePath})`;
  const withoutFooter = beforeImageDeletion
    .slice(0, beforeImageDeletion.lastIndexOf(reference))
    .trimEnd();
  const press = async (key: string, extra: Partial<KeyboardEventInit> = {}) => {
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        ...extra
      })
    );
    await frame();
  };
  select(editor.lastElementChild!.firstChild!, 0);
  await frame();
  await press("Backspace");
  await until(
    async () =>
      !footer.isConnected && (await readSaved()).trimEnd() === withoutFooter,
    "Backspace removed the final image and saved the change"
  );
  await type("后续正文");
  await until(
    async () => (await readSaved()).trimEnd().endsWith("后续正文"),
    "continued typing after deleting the final image"
  );
  await press("z", modifier);
  await until(
    async () => (await readSaved()).trimEnd() === withoutFooter,
    "undo continued text"
  );
  await press("z", modifier);
  await until(
    async () =>
      editor.lastElementChild?.previousElementSibling?.matches(
        ".markdown-image"
      ) === true && (await readSaved()) === beforeImageDeletion,
    "undo restored the final image and its trailing cursor"
  );
  const restored = editor.lastElementChild!.previousElementSibling!;
  const restoredImage = restored.querySelector<HTMLImageElement>("img")!;
  await restoredImage.decode();
  restoredImage.scrollIntoView({ block: "center" });
  await frame();
  const bounds = restoredImage.getBoundingClientRect();
  for (const type of ["mousedown", "mouseup"])
    restoredImage.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2
      })
    );
  await frame();
  if (
    !restored.classList.contains("ProseMirror-selectednode") ||
    parseFloat(getComputedStyle(restored).outlineWidth) === 0
  )
    throw new Error("Clicking the final image did not visibly select it.");
  if ((await readSaved()) !== beforeImageDeletion)
    throw new Error("Selecting the final image changed the document.");
  await press("Delete");
  await until(
    async () =>
      !restored.isConnected && (await readSaved()).trimEnd() === withoutFooter,
    "Delete removed the selected final image"
  );
  await press("z", modifier);
  await until(
    async () =>
      editor.lastElementChild?.previousElementSibling?.matches(
        ".markdown-image"
      ) === true && (await readSaved()) === beforeImageDeletion,
    "undo restored the selected image deletion"
  );
  const lastParagraph = editor.lastElementChild!;
  select(
    lastParagraph.firstChild!,
    lastParagraph.firstChild!.textContent!.length
  );
  await frame();
  editor.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter"
    })
  );
  await frame();
  for (const character of ["#", "#", " "]) await type(character);
  const activeHeading = () => {
    const anchor = getSelection()?.anchorNode;
    return (
      anchor instanceof Element ? anchor : anchor?.parentElement
    )?.closest("h2");
  };
  if (!activeHeading())
    throw new Error(
      "Typing ## followed by a space left literal Markdown instead of creating a heading."
    );
  editor.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Backspace",
      code: "Backspace"
    })
  );
  await frame();
  const literal = editor.lastElementChild!;
  if (literal.tagName !== "P" || literal.textContent !== "## ")
    throw new Error("Backspace did not undo the heading shortcut.");
  select(literal.firstChild!, 2, 3);
  await frame();
  await type(" ");
  if (!activeHeading())
    throw new Error("Heading shortcut could not be applied again.");
  await until(
    async () => (await readSaved()).endsWith("\n\n## "),
    "empty typed heading saved"
  );
  const beforeHeadingComposition = await readSaved();
  editor.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true })
  );
  await type("你啊后", true);
  if ((await readSaved()) !== beforeHeadingComposition)
    throw new Error(
      "Heading IME candidates were saved before composition ended."
    );
  editor.dispatchEvent(
    new CompositionEvent("compositionend", { bubbles: true, data: "你啊后" })
  );
  await until(
    async () =>
      activeHeading()?.textContent === "你啊后" &&
      (await readSaved()).endsWith("\n\n## 你啊后"),
    "typed heading saved without a backslash escape"
  );
  editor.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "z",
      code: "KeyZ",
      ...modifier
    })
  );
  await until(
    () => activeHeading()?.textContent === "",
    "heading text undo retained the heading"
  );
  editor.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "z",
      code: "KeyZ",
      shiftKey: true,
      ...modifier
    })
  );
  await until(
    async () =>
      activeHeading()?.textContent === "你啊后" &&
      (await readSaved()).endsWith("\n\n## 你啊后"),
    "heading text redo retained unescaped Markdown"
  );
  return {
    consecutiveEdits: samples.length,
    automaticallySaved: true,
    sharedUndo: true,
    sharedRedo: true,
    undoKeptPreview: true,
    unchangedImagePreserved: true,
    seamlessEditing: true,
    formattedClicksUnchanged: true,
    formattedEditsPreserved: true,
    imeCommittedOnly: true,
    findKeptPreview: true,
    typedHeadingSaved: true,
    tailImageDeletion: true,
    hiddenImageCaption: true,
    maxInputFrameMs: Math.max(...samples)
  };
}
