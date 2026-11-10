import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyLibraryEntryDialog } from "./smoke-library-entry-dialog";
import type { BrowserWindow } from "electron";
import type { DeepWriteApi } from "@deepwrite/contracts";

async function prepareOrganization() {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const fixtures: Array<{
    domain: "material" | "skill";
    first: string;
    second: string;
    loose: string;
    title: string;
  }> = [];
  for (const domain of ["material", "skill"] as const) {
    const title = `整理验收-${domain}`;
    const first = await api.catalog.createLibrary(
      domain === "material"
        ? {
            domain,
            name: `${title}-甲`,
            materialKind: "other",
            libraryType: "script"
          }
        : {
            domain,
            name: `${title}-甲`,
            skillKind: "general",
            libraryType: "script"
          }
    );
    const second = await api.catalog.createLibrary(
      domain === "material"
        ? {
            domain,
            name: `${title}-乙`,
            materialKind: "other",
            libraryType: "long"
          }
        : {
            domain,
            name: `${title}-乙`,
            skillKind: "general",
            libraryType: "long"
          }
    );
    if (!first || !second)
      throw new Error("Organization fixture creation canceled.");
    const loose = await api.catalog.createUnboundEntry({
      domain,
      title: `${title}-暂存`,
      content: "保留正文",
      libraryType: "short",
      stageId: domain === "material" ? "other" : "draft"
    });
    const plan = await api.catalog.previewLibraryStructure({
      domain,
      requestId: crypto.randomUUID(),
      operations: [
        {
          action: "move-entries",
          libraryId: loose.libraryId,
          entryIds: [loose.entryId],
          target: { kind: "library", libraryId: first.id }
        }
      ]
    });
    await api.catalog.applyLibraryStructure(plan);
    await api.catalog.applyLibraryStructure(plan);
    const disposableInput = {
      libraryId: first.id,
      title: `${title}-删除`,
      content: "待删除正文"
    };
    const disposable = await api.catalog.createLibraryEntry(
      domain === "material"
        ? { ...disposableInput, domain, stageId: "other" }
        : { ...disposableInput, domain, stageId: "draft" }
    );
    const deletion = await api.catalog.previewLibraryStructure({
      domain,
      requestId: crypto.randomUUID(),
      operations: [
        {
          action: "delete-entries",
          libraryId: first.id,
          entryIds: [disposable.id]
        }
      ]
    });
    await api.catalog.applyLibraryStructure(deletion);
    const index = await api.catalog.index();
    const libraries = domain === "material" ? index.materials : index.skills;
    if (
      libraries
        .find((item) => item.id === first.id)
        ?.entries.some((entry) => entry.id === disposable.id)
    )
      throw new Error("Deleted entry is still listed.");
    const restored = await api.catalog.previewLibraryStructure({
      domain,
      requestId: crypto.randomUUID(),
      operations: [
        {
          action: "move-entries",
          libraryId: first.id,
          entryIds: [loose.entryId],
          target: { kind: "unbound" }
        }
      ]
    });
    await api.catalog.applyLibraryStructure(restored);
    fixtures.push({
      domain,
      first: first.id,
      second: second.id,
      loose: loose.entryId,
      title
    });
  }
  return fixtures;
}

async function verifyOrganization(
  fixtures: Awaited<ReturnType<typeof prepareOrganization>>,
  entriesOnly = false
) {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  async function until<T>(
    read: () => T | Promise<T>,
    reason: string
  ): Promise<NonNullable<T>> {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      document
        .querySelector<HTMLButtonElement>(".startup-alert-close")
        ?.click();
      const value = await read();
      if (value) return value as NonNullable<T>;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`Organization smoke timed out: ${reason}`);
  }
  for (const fixture of fixtures) {
    document
      .querySelectorAll<HTMLButtonElement>(
        '.section-toggle[aria-expanded="false"]'
      )
      .forEach((button) => button.click());
    const row = (suffix: string) =>
      [...document.querySelectorAll<HTMLElement>(".tree-row")].find(
        (item) =>
          item.querySelector(".tree-label")?.textContent?.trim() ===
          `${fixture.title}-${suffix}`
      );
    const first = await until(() => row("甲"), "first library row");
    if (!entriesOnly) {
      const second = await until(() => row("乙"), "second library row");
      second.scrollIntoView({ block: "center" });
      const start = second.getBoundingClientRect();
      second.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: start.x + 45,
          clientY: start.y + start.height / 2
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      const ghost = document.querySelector<HTMLElement>(".library-order-ghost");
      if (!ghost || !second.classList.contains("library-order-source"))
        throw new Error("Long-press did not lift the source row.");
      const ghostStyle = getComputedStyle(ghost);
      if (
        ghostStyle.position !== "fixed" ||
        ghostStyle.pointerEvents !== "none" ||
        ghostStyle.boxShadow === "none" ||
        Number(getComputedStyle(second).opacity) >= 1 ||
        Math.abs(second.getBoundingClientRect().height - start.height) > 0.5
      )
        throw new Error(
          "Lifted row styling or source placeholder is incorrect."
        );
      const liftedBounds = ghost.getBoundingClientRect();
      document
        .querySelector<HTMLButtonElement>(".startup-alert-close")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      first.scrollIntoView({ block: "center" });
      const end = first.getBoundingClientRect();
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: end.x + 45,
          clientY: end.y + 2
        })
      );
      const movedBounds = ghost.getBoundingClientRect();
      if (
        Math.abs(
          movedBounds.left - liftedBounds.left - (end.x + 45 - (start.x + 45))
        ) > 1 ||
        Math.abs(
          movedBounds.top -
            liftedBounds.top -
            (end.y + 2 - (start.y + start.height / 2))
        ) > 1
      )
        throw new Error("Lifted row did not follow the pointer.");
      if (!first.classList.contains("library-order-before"))
        throw new Error(
          `Long-press marker missing: ${JSON.stringify({ source: second.dataset.resourceId, target: first.dataset.resourceId, rect: end.toJSON(), hit: document.elementFromPoint(end.x + 45, end.y + 2)?.outerHTML.slice(0, 800), section: first.closest(".resource-section")?.querySelector(".section-toggle")?.textContent })}`
        );
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      if (
        document.querySelector(".library-order-ghost, .library-order-source") ||
        document.documentElement.classList.contains("library-order-dragging")
      )
        throw new Error("Lifted row was not cleaned up after drop.");
      await until(async () => {
        const order =
          (await api.catalog.index()).libraryOrganization?.[fixture.domain] ??
          [];
        return (
          order.indexOf(fixture.second) >= 0 &&
          order.indexOf(fixture.second) < order.indexOf(fixture.first)
        );
      }, "persisted long-press order");
    }
    const section = first.closest(".resource-section")!;
    const looseEntry = await until(() => row("暂存"), "loose entry row");
    if (
      looseEntry.closest(".resource-section") !== section ||
      looseEntry.querySelector(".tree-category-tag")?.textContent?.trim() !==
        "未绑定"
    )
      throw new Error("Loose entry is missing its unbound label.");
    const index = await api.catalog.index();
    const libraries =
      fixture.domain === "material" ? index.materials : index.skills;
    if (
      !libraries.some(
        (item) =>
          item.isUnbound &&
          item.entries.some((entry) => entry.id === fixture.loose)
      )
    )
      throw new Error("Loose entry identity was lost.");
    section.querySelector<HTMLButtonElement>(".section-action")!.click();
    const create = await until(
      () =>
        document.querySelector<HTMLButtonElement>(
          `[data-resource-action="${fixture.domain}-create-entry"]`
        ),
      "new loose entry action"
    );
    create.click();
    let form = await until(
      () => document.querySelector<HTMLFormElement>(".catalog-resource-form"),
      "entry creation form"
    );
    form = await (
      globalThis as unknown as {
        verifyLibraryEntryDialog: (
          form: HTMLFormElement,
          domain: "material" | "skill"
        ) => Promise<HTMLFormElement>;
      }
    ).verifyLibraryEntryDialog(form, fixture.domain);
    if (!form.textContent?.includes("暂不放入库"))
      throw new Error("New entry does not default to unbound.");
    const titleInput =
      form.querySelector<HTMLInputElement>('input[type="text"]')!;
    titleInput.value = `${fixture.title}-界面新增`;
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    form.requestSubmit();
    await until(async () => {
      const snapshot = await api.catalog.index();
      const items =
        fixture.domain === "material" ? snapshot.materials : snapshot.skills;
      return items.some(
        (library) =>
          library.isUnbound &&
          library.entries.some(
            (entry) => entry.title === `${fixture.title}-界面新增`
          )
      );
    }, "unbound entry created through dialog");
    await until(
      () => !document.querySelector(".catalog-resource-form"),
      "creation dialog closed"
    );
  }
  return {
    domains: fixtures.length,
    unbound: true,
    newEntry: true,
    crossType: true,
    dialogLayout: true,
    longPressOrder: !entriesOnly,
    idempotentBatch: true,
    entryDeletion: true
  };
}

export async function runLibraryOrganizationSmoke(
  window: BrowserWindow,
  entriesOnly = false
) {
  if (process.env.DEEPWRITE_SMOKE !== "1")
    throw new Error("Requires an isolated smoke profile.");
  const fixtures = await window.webContents.executeJavaScript(
    `(${prepareOrganization.toString()})()`
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Organization reload timed out.")),
      10000
    );
    window.webContents.once("did-finish-load", () => {
      clearTimeout(timeout);
      resolve();
    });
    window.webContents.reload();
  });
  await window.webContents.executeJavaScript(
    `void (globalThis.verifyLibraryEntryDialog = ${verifyLibraryEntryDialog.toString()})`
  );
  const captures: Promise<void>[] = [];
  window.webContents.on("console-message", (event) => {
    const match =
      /^DEEPWRITE_LIBRARY_DIALOG_CAPTURE (material|skill) (light|dark)$/.exec(
        event.message
      );
    if (!match) return;
    captures.push(
      window
        .capturePage()
        .then((image) =>
          writeFile(
            join(
              tmpdir(),
              `deepwrite-library-entry-${match[1]}-${match[2]}.png`
            ),
            image.toPNG()
          )
        )
    );
  });
  const previousSize = window.getSize();
  if (entriesOnly) window.setSize(900, 650);
  const result = await window.webContents.executeJavaScript(
    `(${verifyOrganization.toString()})(${JSON.stringify(fixtures)}, ${JSON.stringify(entriesOnly)})`,
    true
  );
  await Promise.all(captures);
  if (entriesOnly) window.setSize(previousSize[0]!, previousSize[1]!);
  return result;
}
