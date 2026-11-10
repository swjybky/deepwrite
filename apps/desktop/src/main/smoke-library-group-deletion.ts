import type { BrowserWindow } from "electron";
import type { DeepWriteApi } from "@deepwrite/contracts";

interface GroupDeletionFixture {
  domain: "material" | "skill";
  id: string;
  title: string;
  libraryId: string;
}

async function prepareGroups(): Promise<GroupDeletionFixture[]> {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const fixtures: GroupDeletionFixture[] = [];
  for (const domain of ["material", "skill"] as const) {
    const library = await api.catalog.createLibrary(
      domain === "material"
        ? { domain, name: "分组删除测试素材", materialKind: "other" }
        : { domain, name: "分组删除测试技能", skillKind: "other" }
    );
    if (!library)
      throw new Error("Group deletion smoke requires a disposable workspace.");
    await api.catalog.createLibraryEntry(
      domain === "material"
        ? {
            domain,
            libraryId: library.id,
            title: "测试条目",
            content: "待删除素材",
            stageId: "other"
          }
        : {
            domain,
            libraryId: library.id,
            title: "测试条目",
            content: "待删除技能",
            stageId: "draft"
          }
    );
    const group = await api.catalog.createLibraryGroup({
      domain,
      name: `${domain} 分组删除测试`,
      members: { other: library.id }
    });
    if (!group)
      throw new Error("Group deletion smoke group creation was canceled.");
    fixtures.push({
      domain,
      id: group.id,
      title: group.title,
      libraryId: library.id
    });
  }
  return fixtures;
}

/** Clicks the real tree menu and modal; disk deletion crosses Preload, Main and Core. */
async function deleteGroups(fixtures: GroupDeletionFixture[]) {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  async function until<T>(
    read: () => T | Promise<T>,
    reason: string
  ): Promise<NonNullable<T>> {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      document
        .querySelector<HTMLButtonElement>(".startup-alert-close")
        ?.click();
      const value = await read();
      if (value) return value as NonNullable<T>;
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`Group deletion smoke timed out: ${reason}`);
  }
  for (const fixture of fixtures) {
    const openMenu = async () => {
      document
        .querySelectorAll<HTMLButtonElement>(
          '.section-toggle[aria-expanded="false"]'
        )
        .forEach((button) => button.click());
      const label = await until(
        () =>
          [...document.querySelectorAll<HTMLElement>(".tree-label")].find(
            (node) => node.textContent?.trim() === fixture.title
          ),
        "group tree row"
      );
      const button = label
        .closest(".tree-node")
        ?.querySelector<HTMLButtonElement>(".tree-node-action");
      if (!button)
        throw new Error("Group deletion smoke: missing group action button.");
      button.scrollIntoView({ block: "center" });
      button.click();
      const items = await until(() => {
        const menu = [
          ...document.querySelectorAll<HTMLButtonElement>(
            ".tree-node-action-menu-item"
          )
        ];
        return menu.some((item) => item.textContent?.trim() === "删除分组")
          ? menu
          : null;
      }, "group menu");
      if (
        items
          .slice(-5)
          .map((item) => item.textContent?.trim())
          .join(",") !== "编辑分组,复制,导出,解散分组,删除分组"
      ) {
        throw new Error("Group deletion smoke: menu ordering differs.");
      }
      items.at(-1)!.click();
      await until(
        () => document.querySelector("#library-removal-dialog-title"),
        "group confirmation"
      );
      const warning =
        document.querySelector(".book-remove-warning")?.textContent ?? "";
      if (!warning.includes("永久删除") || !warning.includes("组内全部")) {
        throw new Error(
          "Group deletion smoke: confirmation does not explain member deletion."
        );
      }
    };
    await openMenu();
    document
      .querySelector<HTMLButtonElement>(
        ".book-resource-dialog .dialog-secondary-button"
      )!
      .click();
    await until(
      () => !document.querySelector("#library-removal-dialog-title"),
      "confirmation canceled"
    );
    const before = await api.catalog.snapshot();
    const beforeLibraries =
      fixture.domain === "material" ? before.materials : before.skills;
    if (!beforeLibraries.some(({ id }) => id === fixture.libraryId)) {
      throw new Error("Group deletion smoke: cancellation deleted a member.");
    }
    await openMenu();
    document
      .querySelector<HTMLButtonElement>(
        ".book-resource-dialog .dialog-primary-button"
      )!
      .click();
    await until(async () => {
      const snapshot = await api.catalog.snapshot();
      const groups =
        fixture.domain === "material"
          ? snapshot.materialGroups
          : snapshot.skillGroups;
      const libraries =
        fixture.domain === "material" ? snapshot.materials : snapshot.skills;
      return (
        !groups.some(({ id }) => id === fixture.id) &&
        !libraries.some(({ id }) => id === fixture.libraryId)
      );
    }, "group and member removed from Core");
    await until(
      () => !document.querySelector("#library-removal-dialog-title"),
      "confirmation closed"
    );
    if (
      [...document.querySelectorAll(".tree-label")].some(
        (node) => node.textContent?.trim() === fixture.title
      )
    ) {
      throw new Error(
        "Group deletion smoke: removed group is still in the tree."
      );
    }
  }
  return {
    status: "ok",
    groups: fixtures.length,
    menuOrder: true,
    canceled: true,
    membersDeleted: true
  };
}

export async function runLibraryGroupDeletionSmoke(window: BrowserWindow) {
  if (process.env.DEEPWRITE_SMOKE !== "1") {
    throw new Error("Group deletion smoke requires an isolated smoke profile.");
  }
  const fixtures = await window.webContents.executeJavaScript(
    `(${prepareGroups.toString()})()`
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Group deletion fixture reload timed out.")),
      8_000
    );
    window.webContents.once("did-finish-load", () => {
      clearTimeout(timeout);
      resolve();
    });
    window.webContents.reload();
  });
  return window.webContents.executeJavaScript(
    `(${deleteGroups.toString()})(${JSON.stringify(fixtures)})`,
    true
  );
}
