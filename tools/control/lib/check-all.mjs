import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { checkFeatureMap } from "./feature-map.mjs";
import { REPO_ROOT } from "./paths.mjs";
import { runRepoRules } from "./repo-rules.mjs";

export const ALL_STEPS = [
  "format",
  "lint",
  "typecheck",
  "boundary",
  "i18n",
  "features",
  "rules",
  "tests"
];

export const TYPECHECK_PROJECTS = [
  { area: "frontend", project: "apps/desktop/tsconfig.web.json", vue: true },
  { area: "backend", project: "apps/desktop/tsconfig.node.json" },
  { area: "backend", project: "packages/contracts/tsconfig.json" },
  { area: "backend", project: "packages/shared/tsconfig.json" },
  { area: "backend", project: "packages/pi-runtime-adapter/tsconfig.json" }
];

const FINDING_LIMIT = 20;
const requireFromRoot = createRequire(join(REPO_ROOT, "package.json"));

/** Node entry of a package's bin, so Windows needs no shell to run it. */
export function toolBin(name, binName = name) {
  const manifestPath = requireFromRoot.resolve(`${name}/package.json`);
  const { bin } = requireFromRoot(manifestPath);
  return join(
    dirname(manifestPath),
    typeof bin === "string" ? bin : bin[binName]
  );
}

function repoPath(file) {
  const path = isAbsolute(file) ? relative(REPO_ROOT, file) : file;
  return path.split(sep).join("/");
}

export function areaOf(file) {
  const path = repoPath(file);
  if (path.startsWith("apps/desktop/src/renderer/")) return "frontend";
  if (path.startsWith("apps/desktop/src/") || path.startsWith("packages/"))
    return "backend";
  return "tooling";
}

/**
 * Paths git ignores, as globs. ESLint and Prettier do not read
 * .git/info/exclude, so local-only folders would otherwise be checked.
 */
export function gitIgnoredGlobs(entries) {
  return entries
    .filter(Boolean)
    .map((entry) => entry.replace(/[\\*?[\]{}()!+@]/gu, "\\$&"))
    .map((entry) => (entry.endsWith("/") ? `${entry}**` : entry));
}

function listGitIgnored() {
  const result = spawnSync(
    "git",
    [
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory"
    ],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  return result.status === 0 ? gitIgnoredGlobs(result.stdout.split("\0")) : [];
}

export function parseTscOutput(text) {
  const findings = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/u.exec(line);
    if (match)
      findings.push({
        file: repoPath(match[1]),
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4],
        message: match[5]
      });
  }
  return findings;
}

export function parsePrettierOutput(text) {
  return text
    .split(/\r?\n/u)
    .map((line) => /^\[warn\] (.+)$/u.exec(line)?.[1])
    .filter((file) => file && !/^Code style issues/u.test(file))
    .map((file) => ({ file, message: "格式不符合 Prettier" }));
}

export function eslintFindings(report) {
  return report.flatMap(({ filePath, messages }) =>
    messages.map((message) => ({
      file: repoPath(filePath),
      line: message.line,
      column: message.column,
      rule: message.ruleId ?? (message.fatal ? "parse-error" : "unknown"),
      severity: message.severity === 2 ? "error" : "warning",
      message: message.message
    }))
  );
}

function firstLines(text, count = 4) {
  return text
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .split("\n")
    .filter((line) => !line.includes("node_modules"))
    .slice(0, count)
    .join("\n")
    .replaceAll(`${REPO_ROOT}${sep}`, "");
}

/** Per-area counts and failures from the Vitest JSON reporter. */
export function vitestSummary(report) {
  const areas = {};
  for (const file of report.testResults ?? []) {
    const area = areaOf(file.name);
    const entry = (areas[area] ??= {
      files: 0,
      tests: 0,
      failed: 0,
      findings: []
    });
    entry.files += 1;
    const assertions = file.assertionResults ?? [];
    entry.tests += assertions.length;
    const failures = assertions.filter(
      (assertion) => assertion.status === "failed"
    );
    entry.failed += failures.length;
    for (const failure of failures)
      entry.findings.push({
        file: repoPath(file.name),
        test: failure.fullName,
        message: firstLines(failure.failureMessages?.join("\n") ?? "")
      });
    if (file.status === "failed" && failures.length === 0) {
      entry.failed += 1;
      entry.findings.push({
        file: repoPath(file.name),
        message: firstLines(file.message || "测试文件加载失败")
      });
    }
  }
  return areas;
}

function runProcess(name, command, args, { stream, display }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, FORCE_COLOR: "0" }
    });
    let output = "";
    const collect = (chunk) => {
      output += chunk;
      if (stream) process.stderr.write(chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      output += `\n${error.message}`;
    });
    child.on("close", (code) => {
      resolve({
        step: name,
        ok: code === 0,
        exitCode: code,
        command: display,
        durationMs: Date.now() - started,
        output: output.replace(/\u001b\[[0-9;]*m/gu, "")
      });
    });
  });
}

function tail(output, count = 40) {
  return output.trimEnd().split("\n").slice(-count);
}

/** Raw output only when a failure has no parsed findings to explain it. */
function stepRecord(run, { explained = false, ...extra } = {}) {
  return {
    step: run.step,
    ok: run.ok,
    command: run.command,
    durationMs: run.durationMs,
    ...extra,
    ...(run.ok
      ? {}
      : {
          exitCode: run.exitCode,
          ...(explained ? {} : { tail: tail(run.output) })
        })
  };
}

function bucket(findings) {
  const areas = {};
  for (const finding of findings)
    (areas[areaOf(finding.file)] ??= []).push(finding);
  return areas;
}

function areaResult(ok, findings, extra = {}) {
  return {
    ok,
    problems: findings.length,
    ...extra,
    ...(findings.length > 0
      ? { findings: findings.slice(0, FINDING_LIMIT) }
      : {})
  };
}

/** The plan without running it, for --dry-run. */
export function planAll({ skip = new Set() } = {}) {
  const ignored = listGitIgnored();
  const node = process.execPath;
  const plan = [];
  if (!skip.has("format"))
    plan.push({
      step: "format",
      command: node,
      args: [
        toolBin("prettier"),
        ".",
        "--check",
        ...ignored.map((glob) => `!${glob}`)
      ],
      display: `prettier . --check（排除 ${ignored.length} 个 git 忽略路径）`
    });
  if (!skip.has("lint"))
    plan.push({
      step: "lint",
      command: node,
      args: [
        toolBin("eslint"),
        ".",
        "--max-warnings=0",
        "--format",
        "json",
        ...ignored.flatMap((glob) => ["--ignore-pattern", glob])
      ],
      display: `eslint . --max-warnings=0（排除 ${ignored.length} 个 git 忽略路径）`
    });
  if (!skip.has("typecheck"))
    for (const { project, vue } of TYPECHECK_PROJECTS)
      plan.push({
        step: `typecheck ${project}`,
        command: node,
        args: [
          vue ? toolBin("vue-tsc") : toolBin("typescript", "tsc"),
          "--noEmit",
          "--pretty",
          "false",
          "-p",
          project
        ],
        display: `${vue ? "vue-tsc" : "tsc"} --noEmit -p ${project}`
      });
  if (!skip.has("boundary"))
    plan.push({
      step: "boundary",
      command: node,
      args: ["tools/check-renderer-boundary.mjs"],
      display: "node tools/check-renderer-boundary.mjs"
    });
  if (!skip.has("i18n"))
    plan.push({
      step: "i18n",
      command: node,
      args: ["tools/check-i18n.mjs"],
      display: "node tools/check-i18n.mjs"
    });
  if (!skip.has("features"))
    plan.push({ step: "features", display: "pnpm -s ctl check features" });
  if (!skip.has("rules"))
    plan.push({ step: "rules", display: "pnpm -s ctl check rules" });
  if (!skip.has("tests"))
    plan.push({
      step: "tests",
      command: node,
      args: [toolBin("vitest"), "run", "--reporter=default", "--reporter=json"],
      display: "vitest run"
    });
  return plan;
}

function nextStepsFor(steps) {
  const failed = (name) =>
    steps.some((step) => step.step.startsWith(name) && !step.ok);
  const advice = [];
  if (failed("format"))
    advice.push("格式：pnpm exec prettier --write <findings 里的文件>");
  if (failed("lint"))
    advice.push(
      "lint：先 pnpm exec eslint --fix <文件>，剩下的按 findings 的 rule 和行号手改"
    );
  if (failed("typecheck"))
    advice.push(
      "类型：按 findings 的文件和行号修；单独复查用 steps 里对应的 typecheck 命令"
    );
  if (failed("boundary"))
    advice.push(
      "边界：node tools/check-renderer-boundary.mjs 看完整输出，按 AGENTS.md「IPC」一节改引用"
    );
  if (failed("i18n"))
    advice.push(
      "文案：node tools/check-i18n.mjs 看完整输出，把界面中文移到语言资源"
    );
  if (failed("features"))
    advice.push(
      "功能地图：按 findings 更新 references/features/ 对应页，或 pnpm -s ctl check features 单独复查"
    );
  if (failed("rules"))
    advice.push(
      "仓库规则：按 areas.repo.rules 的 findings 和 advice 修复，可用 pnpm -s ctl check rules <规则名> 复查"
    );
  if (failed("tests"))
    advice.push(
      "测试：pnpm exec vitest run <findings 里的文件> 单独复现；确认是本次改动造成的再修，不改测试去迁就错误行为"
    );
  advice.push(
    `findings 每类最多列 ${FINDING_LIMIT} 条，problems 是总数；修完重跑 pnpm -s ctl check all`
  );
  return advice;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    // The tool crashed before writing its report; the step tail says why.
    return undefined;
  }
}

const CODE_AREAS = ["frontend", "backend", "tooling"];

/** Run every repository check and group the results by frontend, backend and tooling. */
export async function runAllChecks({
  skip = new Set(),
  stream = false,
  groups
}) {
  const started = Date.now();
  const scratch = await mkdtemp(join(tmpdir(), "deepwrite-check-"));
  const steps = [];
  const areas = { frontend: {}, backend: {}, tooling: {}, repo: {} };
  const typecheck = {};
  try {
    for (const item of planAll({ skip })) {
      if (item.step === "features") {
        const begun = Date.now();
        const pages = await checkFeatureMap({ groups });
        const findings = pages.flatMap(({ page, problems }) =>
          problems.map((problem) => ({
            file: `references/features/${page}`,
            ...problem
          }))
        );
        steps.push({
          step: "features",
          ok: findings.length === 0,
          command: item.display,
          durationMs: Date.now() - begun
        });
        areas.repo.features = areaResult(findings.length === 0, findings, {
          pages: pages.length
        });
        continue;
      }
      if (item.step === "rules") {
        const begun = Date.now();
        const rules = runRepoRules(REPO_ROOT);
        const ok = Object.values(rules).every((rule) => rule.ok);
        areas.repo.rules = { ok, ...rules };
        steps.push({
          step: "rules",
          ok,
          command: item.display,
          durationMs: Date.now() - begun
        });
        if (stream)
          for (const [name, rule] of Object.entries(rules)) {
            process.stderr.write(
              `${name}: ${rule.problems} 项（${rule.durationMs} ms）\n`
            );
          }
        continue;
      }

      const report = join(scratch, `${item.step.replace(/\W+/gu, "-")}.json`);
      const args =
        item.step === "lint"
          ? [...item.args, "--output-file", report]
          : item.step === "tests"
            ? [...item.args, `--outputFile.json=${report}`]
            : item.args;
      const run = await runProcess(item.step, item.command, args, {
        stream,
        display: item.display
      });

      if (item.step === "format") {
        const findings = parsePrettierOutput(run.output);
        steps.push(stepRecord(run, { explained: findings.length > 0 }));
        areas.repo.format = areaResult(run.ok, findings);
      } else if (item.step === "lint") {
        const json = await readJson(report);
        const findings = json ? eslintFindings(json) : [];
        const byArea = bucket(findings);
        steps.push(stepRecord(run, { explained: findings.length > 0 }));
        for (const area of CODE_AREAS)
          areas[area].lint = areaResult(
            json ? !byArea[area] : run.ok,
            byArea[area] ?? []
          );
      } else if (item.step.startsWith("typecheck ")) {
        const project = item.step.slice("typecheck ".length);
        const { area } = TYPECHECK_PROJECTS.find(
          (entry) => entry.project === project
        );
        const findings = parseTscOutput(run.output);
        steps.push(
          stepRecord(run, {
            errors: findings.length,
            explained: findings.length > 0
          })
        );
        const entry = (typecheck[area] ??= {
          ok: true,
          findings: [],
          projects: []
        });
        entry.ok &&= run.ok;
        entry.findings.push(...findings);
        entry.projects.push(project);
      } else if (item.step === "tests") {
        const json = await readJson(report);
        const summary = json ? vitestSummary(json) : undefined;
        steps.push(
          stepRecord(run, {
            explained: Object.values(summary ?? {}).some(
              (entry) => entry.failed > 0
            )
          })
        );
        for (const area of CODE_AREAS) {
          const entry = summary?.[area] ?? {
            files: 0,
            tests: 0,
            failed: 0,
            findings: []
          };
          areas[area].tests = {
            ok: summary ? entry.failed === 0 : run.ok,
            files: entry.files,
            tests: entry.tests,
            failed: entry.failed,
            ...(entry.findings.length > 0
              ? { findings: entry.findings.slice(0, FINDING_LIMIT) }
              : {})
          };
        }
      } else {
        steps.push(stepRecord(run));
        areas.repo[item.step] = { ok: run.ok };
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  for (const [area, { ok, findings, projects }] of Object.entries(typecheck))
    areas[area].typecheck = areaResult(ok, findings, { projects });
  const ok = steps.every((step) => step.ok);
  return {
    ok,
    data: {
      durationMs: Date.now() - started,
      skipped: [...skip],
      areas,
      steps
    },
    ...(ok ? {} : { nextSteps: nextStepsFor(steps) })
  };
}
