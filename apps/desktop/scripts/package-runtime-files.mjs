import { createRequire } from "node:module";
import { posix } from "node:path";
import ts from "typescript";

export const REQUIRED_RUNTIME_FILES = [
  "package.json",
  "out/main/index.js",
  "out/main/utilities/core-entry.js",
  "out/main/utilities/agent-entry.js",
  "out/main/utilities/tool-entry.js",
  "out/main/utilities/conversation-storage/worker-entry.js",
  "out/preload/index.js",
  "out/renderer/index.html"
];

function relativeImports(file, source) {
  const imports = [];
  const visit = (node) => {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) &&
                node.expression.text === "require"))
          ? node.arguments[0]
          : undefined;
    if (
      specifier &&
      ts.isStringLiteralLike(specifier) &&
      specifier.text.startsWith(".")
    )
      imports.push(specifier.text);
    ts.forEachChild(node, visit);
  };
  visit(
    ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.JS
    )
  );
  return imports;
}

/** Validate archive contents, including shared bundles referenced by the nested worker entry. */
export function validateRuntimeFiles(files, read) {
  const entries = new Set(
    files.map((file) => file.replace(/^[/\\]+/, "").replaceAll("\\", "/"))
  );
  for (const file of REQUIRED_RUNTIME_FILES)
    if (!entries.has(file))
      throw new Error(`Packaged runtime file is missing: ${file}`);
  const checked = new Set();
  const pending = REQUIRED_RUNTIME_FILES.filter((file) => file.endsWith(".js"));
  while (pending.length) {
    const file = pending.pop();
    if (checked.has(file)) continue;
    checked.add(file);
    const source = read(file);
    for (const specifier of relativeImports(file, source)) {
      const dependency = posix.normalize(
        posix.join(posix.dirname(file), specifier)
      );
      if (!entries.has(dependency))
        throw new Error(
          `Packaged runtime dependency is missing: ${dependency} (from ${file})`
        );
      if (dependency.endsWith(".js")) pending.push(dependency);
    }
  }
  return { entries: entries.size, checkedModules: checked.size };
}

export function verifyPackagedRuntime(archive) {
  // Reuse electron-builder's pinned ASAR reader rather than introducing a parallel packaging dependency.
  const require = createRequire(new URL("../package.json", import.meta.url));
  const builderRequire = createRequire(require.resolve("electron-builder"));
  const appBuilderRequire = createRequire(
    builderRequire.resolve("app-builder-lib")
  );
  const asar = appBuilderRequire("@electron/asar");
  return validateRuntimeFiles(asar.listPackage(archive), (file) =>
    asar.extractFile(archive, file).toString("utf8")
  );
}
