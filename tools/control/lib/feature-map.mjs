import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { REPO_ROOT } from "./paths.mjs";

export const FEATURE_MAP_DIR = join(REPO_ROOT, "references/features");

const CODE_ROOTS = ["apps", "packages", "tools"];
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "out",
  "dist",
  "release",
  ".git"
]);
const CODE_FILE = /\.(?:ts|vue|mjs|js|css)$/u;
const CODE_PREFIX =
  /^(?:apps|packages|tools|components|composables|extras|utilities|main|preload|features|renderer|ipc|kernel|proposal-coordinator|agent-conversation|external-control|device-sync)\//u;
const COMMAND_NAMESPACES = new Set([
  "catalog",
  "long",
  "mystery",
  "session",
  "manuscript",
  "agentTeams",
  "extrasAgent",
  "extrasAgentConfig",
  "deviceSync",
  "generalSettings",
  "models",
  "workspaceDirectory",
  "academicAgents",
  "longAgents",
  "libraryAgents",
  "workspaceAgents"
]);
const SNAKE_TOOL = /^[a-z]+(?:_[a-z]+)+$/u;

async function walk(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.directories.push(path);
      await walk(path, files);
    } else {
      files.files.push(path);
    }
  }
}

/** Every source file and directory under the code roots, as repo paths. */
export async function indexRepository(root = REPO_ROOT) {
  const found = { files: [], directories: [] };
  for (const name of CODE_ROOTS) await walk(join(root, name), found);
  const toRepo = (path) => relative(root, path).split(sep).join("/");
  return {
    files: found.files.map(toRepo),
    directories: found.directories.map(toRepo)
  };
}

function inlineCode(markdown) {
  return [...markdown.matchAll(/`([^`\n]+)`/gu)].map((match) =>
    match[1].trim()
  );
}

function codeBlocks(markdown) {
  return [...markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/gu)].map(
    (match) => match[1]
  );
}

/** A bare or partial path matches any repo path that ends with it. */
function resolvesInRepo(index, token) {
  const clean = token.replace(/\/$/u, "");
  const suffix = `/${clean}`;
  const pool =
    token.endsWith("/") || !CODE_FILE.test(clean)
      ? index.directories
      : index.files;
  return pool.some((path) => path === clean || path.endsWith(suffix));
}

export function codePathTokens(markdown) {
  return [
    ...new Set(
      inlineCode(markdown)
        .flatMap((code) => code.split(/[、，,\s]+/u))
        .map((token) => token.replace(/[（(].*$/u, "").replace(/[)）]$/u, ""))
        .filter(
          (token) =>
            !token.includes("<") &&
            !token.includes("*") &&
            !token.startsWith("~")
        )
        .filter(
          (token) =>
            CODE_FILE.test(token) ||
            (CODE_PREFIX.test(token) && token.endsWith("/"))
        )
    )
  ];
}

export function ctlInvocations(markdown) {
  const lines = [];
  for (const block of codeBlocks(markdown)) {
    for (const raw of block.split("\n")) {
      const line = raw.replace(/\s+#.*$/u, "").trim();
      const match = /^pnpm -s ctl\s+(.+)$/u.exec(line);
      if (match) lines.push(match[1]);
    }
  }
  for (const code of inlineCode(markdown)) {
    const match = /^pnpm -s ctl\s+(.+)$/u.exec(code);
    if (match) lines.push(match[1]);
  }
  return lines;
}

function words(commandLine) {
  return [...commandLine.matchAll(/'[^']*'|"[^"]*"|\S+/gu)].map(
    (match) => match[0]
  );
}

export function checkInvocation(
  groups,
  commandLine,
  globalOptions = ["env", "help"]
) {
  const [groupName, commandName, ...rest] = words(commandLine);
  if (groupName === "help") return undefined;
  const group = groups[groupName];
  if (!group) return `没有命令组「${groupName}」`;
  const command = group.commands[commandName];
  if (!command) return `命令组 ${groupName} 里没有「${commandName}」`;
  const known = new Set([
    ...Object.keys(command.options ?? {}),
    ...globalOptions
  ]);
  for (const word of rest) {
    const flag = /^--([a-z][\w-]*)/u.exec(word)?.[1];
    if (flag && !known.has(flag))
      return `${groupName} ${commandName} 没有参数 --${flag}`;
  }
  return undefined;
}

export function commandNameTokens(markdown) {
  return [
    ...new Set(
      inlineCode(markdown)
        .flatMap((code) => code.split(/[、，,\s/]+/u))
        .filter((token) => /^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/u.test(token))
        .filter(
          (token) => !/\.(?:ts|vue|mjs|js|json|md|css|html)$/u.test(token)
        )
        .filter((token) => COMMAND_NAMESPACES.has(token.split(".")[0]))
    )
  ];
}

export function toolNameTokens(markdown) {
  return [
    ...new Set(
      inlineCode(markdown)
        .flatMap((code) => code.split(/[、，,\s（(]+/u))
        .filter((token) => SNAKE_TOOL.test(token))
    )
  ];
}

async function sourceText(root, directories) {
  const index = { files: [], directories: [] };
  for (const directory of directories) await walk(join(root, directory), index);
  const parts = [];
  for (const file of index.files) {
    if (/\.(?:ts|mjs|js|vue)$/u.test(file) && !/\.test\./u.test(file)) {
      parts.push(await readFile(file, "utf8"));
    }
  }
  return parts.join("\n");
}

/**
 * Mechanical checks a feature page must pass: code paths exist, relative links
 * resolve, CLI invocations name real commands and options, IPC command names
 * and tool names appear in the source.
 */
export async function checkFeatureMap({
  root = REPO_ROOT,
  directory = FEATURE_MAP_DIR,
  groups
}) {
  const index = await indexRepository(root);
  const commandSource = await sourceText(root, [
    "apps/desktop/src/preload",
    "apps/desktop/src/main",
    "packages/contracts/src"
  ]);
  const toolSource = await sourceText(root, [
    "packages/contracts/src/external-control",
    "packages/pi-runtime-adapter/src"
  ]);
  const pages = (await readdir(directory))
    .filter((name) => name.endsWith(".md"))
    .sort();
  const results = [];
  for (const name of pages) {
    const file = join(directory, name);
    const markdown = await readFile(file, "utf8");
    const problems = [];
    for (const token of codePathTokens(markdown)) {
      if (!resolvesInRepo(index, token))
        problems.push({ kind: "path", value: token });
    }
    for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/gu)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z]+:/u.test(target)) continue;
      const absolute = resolve(dirname(file), decodeURI(target));
      try {
        await readFile(absolute).catch(async (error) => {
          if (error.code === "EISDIR") return;
          throw error;
        });
      } catch {
        problems.push({ kind: "link", value: target });
      }
    }
    for (const invocation of ctlInvocations(markdown)) {
      const issue = checkInvocation(groups, invocation);
      if (issue) problems.push({ kind: "cli", value: invocation, issue });
    }
    for (const token of commandNameTokens(markdown)) {
      if (
        !commandSource.includes(`"${token}"`) &&
        !commandSource.includes(`'${token}'`)
      ) {
        problems.push({ kind: "command", value: token });
      }
    }
    for (const token of toolNameTokens(markdown)) {
      if (!toolSource.includes(token))
        problems.push({ kind: "tool", value: token });
    }
    results.push({ page: name, problems });
  }
  return results;
}
