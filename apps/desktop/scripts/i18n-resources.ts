import { createHash } from "node:crypto";
import { messageCatalogKeys } from "../src/localization/message-catalog";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import type { Plugin } from "vite";

const virtualId = "virtual:deepwrite-locale-resources";
const resolvedId = `\0${virtualId}`;
const locales = ["zh-CN", "en-US"] as const;
type MessageTree = { [key: string]: string | MessageTree };

/** Compile static message objects as data assets, never executable startup code. */
export function i18nResourcesPlugin(messagesDirectory: string): Plugin {
  let catalogPromise: Promise<MessageTree> | undefined;
  let development = false;
  let invalidateClient: (() => void) | undefined;
  let watchedPaths = new Set<string>();

  async function readModule(
    path: string,
    paths: Set<string>
  ): Promise<MessageTree> {
    paths.add(path);
    const source = ts.createSourceFile(
      path,
      await readFile(path, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const imports = new Map<string, MessageTree>();
    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        statement.importClause?.name &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        imports.set(
          statement.importClause.name.text,
          await readModule(
            resolve(dirname(path), `${statement.moduleSpecifier.text}.ts`),
            paths
          )
        );
      }
    }
    function value(node: ts.Expression): string | MessageTree {
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
        return value(node.expression);
      if (ts.isIdentifier(node) && imports.has(node.text))
        return imports.get(node.text)!;
      if (ts.isObjectLiteralExpression(node)) {
        const object: MessageTree = {};
        for (const property of node.properties) {
          if (ts.isSpreadAssignment(property)) {
            const spread = value(property.expression);
            if (typeof spread === "string")
              throw new Error(`Invalid message spread in ${path}`);
            Object.assign(object, spread);
          } else if (ts.isShorthandPropertyAssignment(property)) {
            object[property.name.text] = value(property.name);
          } else if (
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name))
          ) {
            object[property.name.text] = value(property.initializer);
          } else {
            throw new Error(
              `Message resources must contain static objects and strings: ${path}`
            );
          }
        }
        return object;
      }
      throw new Error(`Unsupported message expression in ${path}`);
    }
    for (const statement of source.statements) {
      const expression = ts.isExportAssignment(statement)
        ? statement.expression
        : ts.isVariableStatement(statement)
          ? statement.declarationList.declarations.find(
              (declaration) =>
                ts.isIdentifier(declaration.name) &&
                declaration.name.text === "messages"
            )?.initializer
          : undefined;
      if (expression) {
        const result = value(expression);
        if (typeof result !== "string") return result;
      }
    }
    throw new Error(`No static message export in ${path}`);
  }

  function catalog(): Promise<MessageTree> {
    if (catalogPromise) return catalogPromise;
    // Each read owns its dependencies; deleted files must not survive a reload.
    watchedPaths = new Set<string>();
    const pending = readModule(
      resolve(messagesDirectory, "index.ts"),
      watchedPaths
    ).catch((error: unknown) => {
      // A checkout can temporarily leave imports and files out of sync.
      if (catalogPromise === pending) catalogPromise = undefined;
      throw error;
    });
    catalogPromise = pending;
    return pending;
  }
  return {
    name: "deepwrite-locale-resources",
    configResolved(config) {
      development = config.command === "serve";
    },
    configureServer(server) {
      invalidateClient = () => {
        const graph = server.environments.client.moduleGraph;
        const module = graph.getModuleById(resolvedId);
        if (module) graph.invalidateModule(module);
        server.ws.send({ type: "full-reload" });
      };
      server.middlewares.use((request, response, next) => {
        const locale = locales.find(
          (language) => request.url === `/@deepwrite-locales/${language}.json`
        );
        if (!locale) return next();
        void catalog()
          .then((messages) => {
            response.setHeader(
              "Content-Type",
              "application/json; charset=utf-8"
            );
            response.end(JSON.stringify(messages[locale]));
          })
          .catch(next);
      });
    },
    resolveId(id) {
      return id === virtualId ? resolvedId : undefined;
    },
    async load(id) {
      if (id !== resolvedId) return;
      const messages = await catalog();
      for (const path of watchedPaths) this.addWatchFile(path);
      const entries = locales.map((language) => {
        const url = development
          ? JSON.stringify(`/@deepwrite-locales/${language}.json`)
          : `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: "asset", fileName: `locales/${language}.json`, source: JSON.stringify(messages[language]) })}`;
        const schema = createHash("sha256")
          .update(messageCatalogKeys(messages[language]).join("\n"))
          .digest("hex");
        return `${JSON.stringify(language)}: { url: ${url}, schema: ${JSON.stringify(schema)} }`;
      });
      return `export default { ${entries.join(",")} };`;
    },
    watchChange(path) {
      if (!watchedPaths.has(path)) return;
      catalogPromise = undefined;
      invalidateClient?.();
    }
  };
}
