import { spawnSync } from "node:child_process";

const git = (...args) =>
  spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });

// CI never commits, and installs outside a git checkout have no hooks to set.
if (
  process.env.CI !== "true" &&
  git("rev-parse", "--is-inside-work-tree").stdout.trim() === "true"
) {
  const current = git("config", "--get", "core.hooksPath").stdout.trim();
  if (current && current !== ".githooks") {
    console.warn(
      `core.hooksPath 已是 ${current}，未改为 .githooks；提交前检查不会自动运行。`
    );
  } else if (!current) {
    git("config", "core.hooksPath", ".githooks");
  }
}
