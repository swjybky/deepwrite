import { withConfigurationLock } from "./configuration-lock";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  BookTemplateDiskSchema,
  SaveBookTemplateInputSchema,
  type BookTemplate,
  type SaveBookTemplateInput
} from "@deepwrite/contracts";
export class BookTemplateStore {
  private readonly path: string;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(userDataPath: string) {
    this.path = join(userDataPath, "config", "book-templates.json");
  }
  private async read(): Promise<BookTemplate[]> {
    try {
      return BookTemplateDiskSchema.parse(
        JSON.parse(await readFile(this.path, "utf8"))
      ).templates;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("读取新建模板失败，请检查模板配置文件。", {
        cause: error
      });
    }
  }
  async list(): Promise<BookTemplate[]> {
    await this.writes;
    return this.read();
  }
  private mutate<T>(operation: (templates: BookTemplate[]) => T): Promise<T> {
    const task = this.writes.then(() =>
      withConfigurationLock(this.path, async () => {
        const templates = await this.read();
        const result = operation(templates);
        await mkdir(dirname(this.path), { recursive: true });
        const temp = `${this.path}.${randomUUID()}.tmp`;
        await writeFile(
          temp,
          JSON.stringify({ version: 1, templates }, null, 2),
          { encoding: "utf8", mode: 0o600 }
        );
        await rename(temp, this.path);
        return result;
      })
    );
    this.writes = task.catch(() => undefined);
    return task;
  }
  async save(raw: SaveBookTemplateInput): Promise<BookTemplate> {
    const input = SaveBookTemplateInputSchema.parse(raw);
    return this.mutate((templates) => {
      const index = input.id
        ? templates.findIndex((template) => template.id === input.id)
        : -1;
      if (input.id && index < 0) throw new Error("模板已删除，请刷新后重试。");
      const template = {
        id: input.id ?? `template_${randomUUID()}`,
        configuration: input.configuration
      };
      if (index < 0) templates.push(template);
      else templates[index] = template;
      return template;
    });
  }
  async delete(id: string): Promise<void> {
    await this.mutate((templates) => {
      const index = templates.findIndex((template) => template.id === id);
      if (index < 0) throw new Error("模板已删除，请刷新后重试。");
      templates.splice(index, 1);
    });
  }
}
