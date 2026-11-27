import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import t from "typescript";
import { UTILITY_ENTRY_NAMES } from "../../../apps/desktop/src/main/utility-entry-names.ts";
import { REPO_ROOT } from "./paths.mjs";

const SKIP_DIRECTORIES = new Set(["node_modules", "out", "dist", "release"]);
const TEST_FILE =
  /(?:\.test(?:-support)?\.|[-/]test-support\.|\/(?:test-utils|fixtures|__mocks__|__snapshots__)\/)/u;
const CODE_FILE = /\.(?:[cm]?[jt]s|vue)$/u;

function toRepo(root, path) {
  return relative(root, path).split(sep).join("/");
}

function walk(directory, accept, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return found;
    throw error;
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, accept, found);
    else if (entry.isFile() && accept(path)) found.push(path);
  }
  return found;
}

const SOURCE_ROOTS = [
  "apps/desktop/src",
  "packages/contracts/src",
  "packages/shared/src",
  "packages/pi-runtime-adapter/src"
];

function sourceFiles(root) {
  return SOURCE_ROOTS.flatMap((dir) =>
    walk(
      join(root, dir),
      (path) => CODE_FILE.test(path) && !path.endsWith(".d.ts")
    )
  );
}

const ALIASES = {
  "@deepwrite/contracts": "packages/contracts/src",
  "@deepwrite/shared": "packages/shared/src",
  "@deepwrite/pi-runtime-adapter": "packages/pi-runtime-adapter/src"
};

function resolveImport(root, from, spec) {
  const clean = spec.replace(/\?.*$/u, "");
  let base;
  if (clean.startsWith(".")) base = resolve(dirname(from), clean);
  else {
    const alias = Object.keys(ALIASES).find(
      (name) => clean === name || clean.startsWith(`${name}/`)
    );
    if (!alias) return undefined;
    base = join(root, ALIASES[alias], clean.slice(alias.length) || "index");
  }
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.vue`,
    `${base}.mjs`,
    `${base}.js`,
    base.replace(/\.js$/u, ".ts"),
    join(base, "index.ts")
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function parseSource(file) {
  let source = readFileSync(file, "utf8");
  if (file.endsWith(".vue")) {
    const scripts = source.matchAll(
      /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gu
    );
    const blank = (text) => text.replace(/[^\r\n]/gu, " ");
    let end = 0;
    const chunks = [];
    for (const match of scripts) {
      const [block, open, body, close] = match;
      chunks.push(
        blank(source.slice(end, match.index)),
        blank(open),
        body,
        blank(close)
      );
      end = match.index + block.length;
    }
    source = chunks.join("");
  }
  return t.createSourceFile(
    file,
    source,
    t.ScriptTarget.Latest,
    false,
    t.ScriptKind.TS
  );
}

function importSpecifiers(file) {
  const imports = [];
  function visit(node) {
    let specifier;
    if (t.isImportDeclaration(node) || t.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (t.isImportTypeNode(node) && t.isLiteralTypeNode(node.argument)) {
      specifier = node.argument.literal;
    } else if (
      (t.isCallExpression(node) &&
        (node.expression.kind === t.SyntaxKind.ImportKeyword ||
          (t.isIdentifier(node.expression) &&
            node.expression.text === "require"))) ||
      (t.isNewExpression(node) &&
        t.isIdentifier(node.expression) &&
        node.expression.text === "URL")
    ) {
      specifier = node.arguments?.[0];
    }
    if (specifier && t.isStringLiteralLike(specifier))
      imports.push(specifier.text);
    t.forEachChild(node, visit);
  }
  visit(parseSource(file));
  return imports;
}

/** Import edges between repository files, resolved to absolute paths. */
export function importGraph(root = REPO_ROOT, extraFiles = []) {
  const files = [...sourceFiles(root), ...extraFiles];
  const edges = new Map();
  for (const file of files) {
    const targets = new Set();
    for (const specifier of importSpecifiers(file)) {
      const target = resolveImport(root, file, specifier);
      if (target && target !== file) targets.add(target);
    }
    edges.set(file, targets);
  }
  return { files, edges };
}

/** Build entries: electron-vite inputs, the renderer entry, and the hand-run scripts. */
export function buildEntries(root = REPO_ROOT) {
  const config = readFileSync(
    join(root, "apps/desktop/electron.vite.config.ts"),
    "utf8"
  );
  const sourceEntries = [...config.matchAll(/"(src\/[\w/.-]+\.ts)"/gu)].map(
    (match) => match[1]
  );
  if (config.includes("Object.values(UTILITY_ENTRY_NAMES)"))
    sourceEntries.push(
      ...Object.values(UTILITY_ENTRY_NAMES).map((name) => `src/${name}.ts`)
    );
  const fromConfig = sourceEntries.map((entry) =>
    join(root, "apps/desktop", entry)
  );
  const html = readFileSync(
    join(root, "apps/desktop/src/renderer/index.html"),
    "utf8"
  );
  const fromHtml = [...html.matchAll(/src="\/?([\w/.-]+\.ts)"/gu)].map(
    (match) => join(root, "apps/desktop/src/renderer", match[1])
  );
  const scripts = [
    ...walk(join(root, "apps/desktop/scripts"), (path) =>
      /\.(mjs|ts)$/u.test(path)
    ),
    ...walk(join(root, "tools"), (path) => /\.(mjs|ts)$/u.test(path))
  ];
  return { entries: [...fromConfig, ...fromHtml], scripts };
}

/** Production sources must be used by a build entry or a runnable script. */
export function deadFiles(root = REPO_ROOT) {
  const { entries, scripts } = buildEntries(root);
  const { files, edges } = importGraph(root, scripts);
  const reachable = new Set();
  const stack = [
    ...entries,
    ...scripts.filter((file) => !/\.test\./u.test(file))
  ];
  while (stack.length) {
    const file = stack.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const next of edges.get(file) ?? []) stack.push(next);
  }
  return files
    .filter((file) => !reachable.has(file))
    .map((file) => toRepo(root, file))
    .filter((path) => !TEST_FILE.test(path))
    .sort();
}

export function duplicateFunctions(root = REPO_ROOT, minLength = 200) {
  const printer = t.createPrinter({
    removeComments: true,
    newLine: t.NewLineKind.LineFeed
  });
  const bodies = new Map();
  for (const file of sourceFiles(root)) {
    const path = toRepo(root, file);
    if (TEST_FILE.test(path) || /\/smoke-/u.test(path)) continue;
    const source = parseSource(file);
    const visit = (node) => {
      let name;
      let body;
      if (t.isFunctionDeclaration(node) && node.name && node.body) {
        name = node.name.text;
        body = node.body;
      } else if (
        t.isVariableDeclaration(node) &&
        t.isIdentifier(node.name) &&
        node.initializer &&
        (t.isArrowFunction(node.initializer) ||
          t.isFunctionExpression(node.initializer))
      ) {
        name = node.name.text;
        body = node.initializer.body;
      }
      if (name && body && body.end - body.pos >= minLength) {
        const normalized = printer
          .printNode(t.EmitHint.Unspecified, body, source)
          .trim();
        if (normalized.replace(/\s+/gu, "").length >= minLength) {
          const key = createHash("sha1").update(normalized).digest("hex");
          const line =
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1;
          if (!bodies.has(key)) bodies.set(key, []);
          bodies.get(key).push({ file: path, line, name });
        }
      }
      t.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...bodies.values()]
    .filter((copies) => new Set(copies.map(({ file }) => file)).size > 1)
    .map((copies) => ({ length: copies.length, copies }));
}

function layerOf(path) {
  const app =
    /^apps\/desktop\/src\/(main|preload|utilities|renderer|extras)\//u.exec(
      path
    );
  if (app) return app[1];
  const pkg = /^packages\/([^/]+)\//u.exec(path);
  return pkg ? `packages/${pkg[1]}` : undefined;
}

const FORBIDDEN_LAYERS = {
  utilities: ["main", "extras", "renderer", "preload"],
  main: ["utilities", "renderer"],
  extras: ["utilities", "renderer"],
  preload: ["main", "utilities", "extras", "renderer"],
  renderer: ["main", "utilities", "extras", "preload"],
  "packages/contracts": ["main", "utilities", "extras", "renderer", "preload"],
  "packages/shared": ["main", "utilities", "extras", "renderer", "preload"],
  "packages/pi-runtime-adapter": [
    "main",
    "utilities",
    "extras",
    "renderer",
    "preload"
  ]
};

// Main and Core must exclude each other with the same on-disk lock protocol.
const ALLOWED_LAYER_EDGES = new Set([
  "apps/desktop/src/main/configuration-lock.ts => apps/desktop/src/utilities/project-transaction/lock.ts"
]);

/** Imports that cross a process boundary: Core, Main, Preload and Renderer run separately. */
export function layerViolations(root = REPO_ROOT) {
  const { edges } = importGraph(root);
  const violations = [];
  for (const [from, targets] of edges) {
    const fromPath = toRepo(root, from);
    if (TEST_FILE.test(fromPath)) continue;
    const fromLayer = layerOf(fromPath);
    for (const target of targets) {
      const toPath = toRepo(root, target);
      // Static text such as the external-control Skill is bundled, not run across processes.
      if (!CODE_FILE.test(toPath)) continue;
      const toLayer = layerOf(toPath);
      if (!fromLayer || !toLayer || fromLayer === toLayer) continue;
      if (!FORBIDDEN_LAYERS[fromLayer]?.includes(toLayer)) continue;
      if (ALLOWED_LAYER_EDGES.has(`${fromPath} => ${toPath}`)) continue;
      violations.push({
        from: fromPath,
        to: toPath,
        rule: `${fromLayer} → ${toLayer}`
      });
    }
  }
  return violations;
}

/** Dependencies must come from the pnpm catalog or the workspace. */
export function dependencySourceViolations(root = REPO_ROOT) {
  const manifests = [
    "package.json",
    ...readdirSync(join(root, "apps")).map(
      (name) => `apps/${name}/package.json`
    ),
    ...readdirSync(join(root, "packages")).map(
      (name) => `packages/${name}/package.json`
    )
  ].filter((path) => existsSync(join(root, path)));
  const violations = [];
  for (const path of manifests) {
    const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies"
    ]) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        if (!/^(catalog:|workspace:)/u.test(version))
          violations.push({ file: path, dependency: name, version });
      }
    }
  }
  return violations;
}

const PLACEHOLDER =
  /(?:^|[_-])(?:test|invalid|example|placeholder|fake|dummy)(?:[_-]|$)/iu;
const CREDENTIAL =
  /sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/gu;
const OWN_HOST = /https?:\/\/([A-Za-z0-9.-]*deepwrite[A-Za-z0-9.-]*)/giu;
const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/gu;
const RUNTIME_VERSION =
  /^\s*"(?:v8|zlib)"\s*:\s*"\d+(?:\.\d+){3}(?:-[\w.]+)?",?\s*$/u;
// These tests exist to prove private and reserved addresses are refused.
const ADDRESS_CLASS_TESTS = /^packages\/pi-runtime-adapter\/src\/web-search\//u;

function isPublicIpv4(parts) {
  const [a, b, c] = parts.map(Number);
  if (parts.some((part) => Number(part) > 255)) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export function sensitiveContent(root = REPO_ROOT) {
  const files = [
    ...SOURCE_ROOTS.flatMap((dir) =>
      walk(join(root, dir), (path) =>
        /\.(?:[cm]?[jt]s|vue|json|snap|txt|log|md)$/u.test(path)
      )
    ),
    ...walk(join(root, "tools"), (path) => /\.(mjs|ts|json)$/u.test(path)),
    ...walk(join(root, "apps/desktop/scripts"), (path) =>
      /\.(mjs|ts|json|html)$/u.test(path)
    ),
    ...walk(join(root, "test"), (path) => /\.(?:json|log|txt)$/u.test(path))
  ];
  const findings = [];
  for (const file of files) {
    const path = toRepo(root, file);
    if (!TEST_FILE.test(path) && !path.startsWith("test/")) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      for (const match of text.matchAll(CREDENTIAL))
        if (!PLACEHOLDER.test(match[0]))
          findings.push({
            file: path,
            line: index + 1,
            kind: "credential"
          });
      for (const match of text.matchAll(OWN_HOST))
        if (!/\.(test|invalid)$/iu.test(match[1]))
          findings.push({
            file: path,
            line: index + 1,
            kind: "own-domain"
          });
      if (!ADDRESS_CLASS_TESTS.test(path) && !RUNTIME_VERSION.test(text))
        for (const match of text.matchAll(IPV4))
          if (isPublicIpv4(match.slice(1)))
            findings.push({
              file: path,
              line: index + 1,
              kind: "public-ip"
            });
    });
  }
  return findings;
}

// Installs or repairs the runtime with Node; it never starts Electron.
const ELECTRON_GUARD_EXEMPT = new Set(["tools/ensure-electron-runtime.mjs"]);

/** Scripts that start the Electron binary must call assertElectronLaunchAllowed first. */
export function electronLaunchGuardViolations(root = REPO_ROOT) {
  const scripts = [
    ...walk(join(root, "tools"), (path) => /\.mjs$/u.test(path)),
    ...walk(join(root, "apps/desktop/scripts"), (path) => /\.mjs$/u.test(path))
  ];
  return scripts
    .map((file) => [toRepo(root, file), readFileSync(file, "utf8")])
    .filter(
      ([path, text]) =>
        !TEST_FILE.test(path) &&
        !ELECTRON_GUARD_EXEMPT.has(path) &&
        /electron\/dist|Electron\.app\/Contents|electron\.exe/u.test(text) &&
        /\b(spawn|execFile|spawnSync|execFileSync)\(/u.test(text) &&
        (!/import\s*\{[^}]*\bassertElectronLaunchAllowed\b[^}]*\}\s*from\s*["'][^"']*electron-launch-environment\.mjs["']/u.test(
          text
        ) ||
          !/\bassertElectronLaunchAllowed\s*\(/u.test(text))
    )
    .map(([path]) => ({ file: path }));
}

/** Commands Preload sends on the shared command channel that no Main or extras code handles. */
export function unroutedCommands(root = REPO_ROOT) {
  const preload = walk(
    join(root, "apps/desktop/src/preload"),
    (path) => /\.ts$/u.test(path) && !TEST_FILE.test(path)
  );
  const sent = new Map();
  for (const file of preload) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("invokeCommand(")) continue;
    for (const match of text.matchAll(
      /createEnvelope\(\s*"([a-zA-Z]+\.[a-zA-Z_]+)"/gu
    ))
      sent.set(match[1], toRepo(root, file));
  }
  const handlers = ["apps/desktop/src/main", "apps/desktop/src/extras"]
    .flatMap((dir) =>
      walk(
        join(root, dir),
        (path) => /\.ts$/u.test(path) && !TEST_FILE.test(path)
      )
    )
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const prefixes = [
    ...handlers.matchAll(/startsWith\("([a-zA-Z]+\.)"\)/gu)
  ].map((match) => match[1]);
  return [...sent]
    .filter(
      ([type]) =>
        !handlers.includes(`"${type}"`) &&
        !prefixes.some((prefix) => type.startsWith(prefix))
    )
    .map(([type, file]) => ({ command: type, file }));
}

/** Every external control tool and error code must appear in the Skill handed to outside agents. */
export function externalSkillDrift(root = REPO_ROOT) {
  const routes = readFileSync(
    join(root, "apps/desktop/src/extras/external-control/tool-routes.ts"),
    "utf8"
  );
  const protocol = readFileSync(
    join(root, "packages/contracts/src/external-control/protocol.ts"),
    "utf8"
  );
  const skill = readFileSync(
    join(root, "apps/desktop/src/extras/external-control/skill/SKILL.md"),
    "utf8"
  );
  const tools = [
    ...routes.matchAll(/^\s*case\s+"([a-z]+(?:_[a-z]+)+)"\s*:/gmu)
  ].map((match) => match[1]);
  const codesBlock =
    /ExternalControlErrorCodeSchema = z\.enum\(\[([\s\S]*?)\]\)/u.exec(
      protocol
    )?.[1];
  const codes = [...(codesBlock ?? "").matchAll(/"([^"]+)"/gu)].map(
    (match) => match[1]
  );
  function compare(kind, source, heading, pattern) {
    const section =
      skill
        .split(/^## /mu)
        .find((part) => part.split(/\r?\n/u, 1)[0] === heading) ?? "";
    const documented = new Set(
      [...section.matchAll(pattern)].map((match) => match[1])
    );
    const expected = new Set(source);
    if (expected.size === 0) return [{ kind, issue: "无法从源码读取清单" }];
    return [
      ...[...expected]
        .filter((name) => !documented.has(name))
        .map((name) => ({ kind, name, issue: "文档缺少" })),
      ...[...documented]
        .filter((name) => !expected.has(name))
        .map((name) => ({ kind, name, issue: "源码已无此项" }))
    ];
  }
  return [
    ...compare("tool", tools, "Tools", /`([a-z]+(?:_[a-z]+)+)`/gu),
    ...compare(
      "error-code",
      codes,
      "When the tools fail",
      /`(external\.[a-z_]+)`/gu
    )
  ];
}

export const RULES = {
  "dead-files": {
    run: deadFiles,
    advice:
      "删除没人用的文件；确实是新入口就加进 electron.vite.config.ts，脚本放进 apps/desktop/scripts 或 tools"
  },
  duplicates: {
    run: duplicateFunctions,
    advice:
      "相同的函数体只留一份：通用工具放 @deepwrite/shared（Node 专用放 @deepwrite/shared/node），业务逻辑放进它所属的模块后导入"
  },
  layers: {
    run: layerViolations,
    advice:
      "跨进程只走 contracts 的命令；共享的纯逻辑放 packages/，代码放到实际运行它的那一层"
  },
  "dependency-sources": {
    run: dependencySourceViolations,
    advice:
      "把版本写进 pnpm-workspace.yaml 的 catalog，package.json 里写 catalog:"
  },
  "sensitive-content": {
    run: sensitiveContent,
    advice:
      "测试、夹具、Mock 里的地址换成 example.test，凭据换成带 test/invalid 字样的占位值；若是真实泄露，移除后还要轮换凭据"
  },
  "electron-launch-guard": {
    run: electronLaunchGuardViolations,
    advice:
      "启动 Electron 前先调用 tools/electron-launch-environment.mjs 的 assertElectronLaunchAllowed()"
  },
  "ipc-routes": {
    run: unroutedCommands,
    advice:
      "在 apps/desktop/src/main/index.ts（或对应的 ipc/*-commands.ts）给这条命令加路由，否则 Renderer 调用会抛 Unreachable command variant"
  },
  "external-skill": {
    run: externalSkillDrift,
    advice:
      "按实际工具路由与错误码更新 apps/desktop/src/extras/external-control/skill/SKILL.md 的 Tools 或 When the tools fail"
  }
};

export function runRepoRules(root = REPO_ROOT, only) {
  const results = {};
  for (const [name, rule] of Object.entries(RULES)) {
    if (only && !only.has(name)) continue;
    const started = Date.now();
    const findings = rule.run(root);
    results[name] = {
      ok: findings.length === 0,
      problems: findings.length,
      durationMs: Date.now() - started,
      ...(findings.length
        ? { findings: findings.slice(0, 20), advice: rule.advice }
        : {})
    };
  }
  return results;
}
