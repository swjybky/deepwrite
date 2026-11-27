import { createRequire } from "node:module";
import { open } from "node:fs/promises";
import { normalize, posix } from "node:path";
import ts from "typescript";
import { UTILITY_ENTRY_NAMES } from "../src/main/utility-entry-names.ts";

export const REQUIRED_RUNTIME_FILES = [
  "package.json",
  "out/main/index.js",
  ...Object.values(UTILITY_ENTRY_NAMES).map((name) => `out/main/${name}.js`),
  "out/main/utilities/conversation-storage/worker-entry.js",
  "out/preload/index.js",
  "out/renderer/index.html",
  "out/renderer/app-icon.png"
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
    // ASAR 3 traverses directories using the host separator, while inventory
    // validation uses POSIX paths for portable module resolution.
    asar.extractFile(archive, normalize(file)).toString("utf8")
  );
}

export async function verifyWindowsArchitecture(executable, arch) {
  const machine = { x64: 0x8664, arm64: 0xaa64 }[arch];
  if (!machine) throw new Error(`Unsupported Windows architecture: ${arch}`);
  const file = await open(executable, "r");
  try {
    const dos = Buffer.alloc(64);
    const header = await file.read(dos, 0, dos.length, 0);
    if (header.bytesRead !== dos.length || dos.toString("ascii", 0, 2) !== "MZ")
      throw new Error("Invalid Windows executable header.");
    const pe = Buffer.alloc(6);
    const result = await file.read(pe, 0, pe.length, dos.readUInt32LE(60));
    if (result.bytesRead !== pe.length || pe.readUInt32LE(0) !== 0x4550)
      throw new Error("Invalid Windows PE header.");
    if (pe.readUInt16LE(4) !== machine)
      throw new Error(
        `Windows runtime architecture mismatch: expected ${arch}.`
      );
  } finally {
    await file.close();
  }
}
