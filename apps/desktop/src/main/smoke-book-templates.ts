import type { BrowserWindow } from "electron";
import type { DeepWriteApi } from "@deepwrite/contracts";

/** Runs through the application's actual Preload, Main entry and Core. */
async function bookTemplateSmokeInRenderer() {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const ensure = (condition: unknown, reason: string) => {
    if (!condition) throw new Error(`Book template smoke: ${reason}`);
  };
  const before = await api.bookTemplates.list();
  const skill = await api.catalog.createLibrary({
    domain: "skill",
    name: "模板测试技能",
    skillKind: "style"
  });
  const material = await api.catalog.createLibrary({
    domain: "material",
    name: "模板测试素材",
    materialKind: "character"
  });
  if (!skill || !material)
    throw new Error("Smoke workspace was not configured");
  for (const workspaceType of ["short", "script"] as const) {
    for (const characterFormat of ["text", "list"] as const) {
      const configuration = {
        workspaceType,
        characterFormat,
        name: "模板测试",
        genre: "其他" as const,
        defaultPlotStageIds: ["outline"],
        linkedSkillIdsByKind: {
          general: [],
          plot: [],
          style: [skill.id],
          other: []
        },
        linkedMaterialIdsByKind: {
          character: [material.id],
          gimmick: [],
          plot: [],
          draft: [],
          other: []
        }
      };
      const saved = await api.bookTemplates.save({ configuration });
      ensure(
        (await api.bookTemplates.list()).some((item) => item.id === saved.id),
        "saved template missing"
      );
      const book = await api.catalog.createBookFromTemplate({
        templateId: saved.id,
        title: "模板创建作品"
      });
      if (!book) throw new Error("Template creation was unexpectedly canceled");
      ensure(
        book.bookType === workspaceType && book.genre === configuration.genre,
        "work type or genre differs"
      );
      ensure(
        book.characterStructure.format === characterFormat,
        "character format differs"
      );
      if (book.characterStructure.format === "list")
        ensure(
          book.characterStructure.items.length === 0,
          "characters were prefilled"
        );
      ensure(
        book.documents.every((doc) => doc.content === ""),
        "documents were prefilled"
      );
      ensure(
        JSON.stringify(
          book.plotStages
            .filter((stage) => stage.enabled)
            .map((stage) => stage.id)
        ) === '["outline"]',
        "template stages differ"
      );
      ensure(
        book.linkedSkillIdsByKind.style[0] === skill.id &&
          book.linkedMaterialIdsByKind.character[0] === material.id,
        "library links differ"
      );
      const edited = await api.bookTemplates.save({
        id: saved.id,
        configuration: {
          ...configuration,
          name: "已编辑模板",
          defaultPlotStageIds: ["plot_design"]
        }
      });
      ensure(
        edited.id === saved.id && edited.configuration.name === "已编辑模板",
        "edit failed"
      );
      await api.bookTemplates.delete({ id: saved.id });
      ensure(
        !(await api.bookTemplates.list()).some((item) => item.id === saved.id),
        "delete failed"
      );
      const reopened = (await api.catalog.snapshot()).books.find(
        (item) => item.id === book.id
      );
      ensure(
        JSON.stringify(reopened) === JSON.stringify(book),
        "template edit or deletion changed the created work"
      );
      let rejected = false;
      try {
        await api.catalog.createBookFromTemplate({
          templateId: saved.id,
          title: "失效模板"
        });
      } catch {
        rejected = true;
      }
      ensure(rejected, "deleted template was accepted");
      await api.catalog.deleteBook(book.id);
    }
  }
  const team = (await api.agentTeams.list()).teams.find(
    (candidate) => candidate.workspaceType === "short"
  );
  if (!team) throw new Error("Book template smoke: no short team");
  const boundTemplate = await api.bookTemplates.save({
    configuration: {
      workspaceType: "short",
      characterFormat: "text",
      name: "团队绑定模板",
      genre: "其他",
      defaultPlotStageIds: ["outline"],
      linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] },
      linkedMaterialIdsByKind: {
        character: [],
        gimmick: [],
        plot: [],
        draft: [],
        other: []
      },
      linkedAgentTeamIds: [team.id]
    }
  });
  ensure(
    boundTemplate.configuration.linkedAgentTeamIds?.[0] === team.id,
    "template lost its team binding"
  );
  const boundBook = await api.catalog.createBookFromTemplate({
    templateId: boundTemplate.id,
    title: "团队绑定作品"
  });
  if (!boundBook) throw new Error("Bound template creation was canceled");
  const bound = await api.agentTeams.setBookBinding({
    bookId: boundBook.id,
    workspaceType: "short",
    teamIds: [team.id]
  });
  ensure(
    bound.bookBindings?.[boundBook.id]?.[0] === team.id,
    "book team binding was not saved"
  );
  await api.catalog.deleteBook(boundBook.id);
  ensure(
    !(await api.agentTeams.list()).bookBindings?.[boundBook.id],
    "deleting a book left its team binding behind"
  );
  await api.bookTemplates.delete({ id: boundTemplate.id });
  ensure(
    (await api.bookTemplates.list()).length === before.length,
    "temporary templates were not removed"
  );
  return {
    status: "ok",
    created: 4,
    crud: true,
    reopened: true,
    deletedRejected: true,
    teamBinding: true
  };
}

export function runBookTemplateSmoke(window: BrowserWindow) {
  return window.webContents.executeJavaScript(
    `(${bookTemplateSmokeInRenderer.toString()})()`
  );
}
