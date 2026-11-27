import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./output.mjs";

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
export const DESKTOP_APP_DIR = join(REPO_ROOT, "apps/desktop");
const ENV_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/u;

function contains(root, candidate) {
  const offset = relative(root, candidate);
  return (
    offset === "" ||
    (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
  );
}

/** Real data the CLI must never write: the developer's profiles and works. */
export function protectedRoots({
  home = homedir(),
  platform = process.platform,
  env = process.env
} = {}) {
  const appData =
    platform === "darwin"
      ? join(home, "Library/Application Support")
      : platform === "win32"
        ? (env.APPDATA ?? join(home, "AppData/Roaming"))
        : (env.XDG_CONFIG_HOME ?? join(home, ".config"));
  return [
    join(appData, "@deepwrite"),
    join(appData, "DeepWrite"),
    join(home, "Documents"),
    join(home, ".deepwrite")
  ].map((path) => resolve(path));
}

export function resolveTestRoot({ env = process.env, home = homedir() } = {}) {
  const root = resolve(
    env.DEEPWRITE_TEST_ROOT || join(home, ".deepwrite-test")
  );
  const unsafe =
    contains(root, resolve(home)) ||
    protectedRoots({ home, env }).some(
      (path) => contains(path, root) || contains(root, path)
    );
  if (unsafe) {
    throw new CliError(
      "guard.unsafe_test_root",
      `测试根目录 ${root} 与开发者的真实数据重叠，拒绝使用。`,
      {
        nextSteps: [
          "取消 DEEPWRITE_TEST_ROOT，使用默认的 ~/.deepwrite-test",
          "或把 DEEPWRITE_TEST_ROOT 指向一个专用的空目录"
        ]
      }
    );
  }
  return root;
}

export function testLayout(name = "default", options = {}) {
  if (!ENV_NAME.test(name)) {
    throw new CliError(
      "cli.invalid_env_name",
      `环境名「${name}」无效：只能用小写字母、数字和连字符，最长 32 个字符。`,
      { nextSteps: ["去掉 --env 使用默认环境，或换一个合法的环境名"] }
    );
  }
  const testRoot = resolveTestRoot(options);
  const root = join(testRoot, name);
  const profile = join(root, "profile");
  return {
    name,
    testRoot,
    root,
    profile,
    config: join(profile, "config"),
    workspace: join(root, "workspace"),
    control: join(root, "control"),
    controlState: join(root, "control", "control.json"),
    logs: join(root, "logs"),
    artifacts: join(root, "artifacts"),
    snapshots: join(root, "snapshots"),
    stateFile: join(root, "state.json")
  };
}

/** Every write and delete goes through here first. */
export function assertInsideTestEnvironment(layout, target) {
  const path = resolve(target);
  if (!contains(layout.root, path)) {
    throw new CliError(
      "guard.outside_test_root",
      `拒绝改动测试环境之外的路径：${path}`,
      {
        nextSteps: [
          "这是 CLI 的防护拦截，不要绕过；检查命令参数是否指向了真实数据"
        ]
      }
    );
  }
  return path;
}

/**
 * Screenshots and reports may also go to the repository's test/ archive,
 * which AGENTS.md asks for; nowhere else outside the environment.
 */
export function resolveArtifactPath(layout, target) {
  const path = resolve(target);
  if (contains(layout.root, path) || contains(join(REPO_ROOT, "test"), path)) {
    return path;
  }
  throw new CliError(
    "guard.outside_artifact_roots",
    `产物只能写到测试环境或仓库 test/ 目录：${path}`,
    {
      nextSteps: [
        `改用 ${join(REPO_ROOT, "test")}/<日期-主题>/ 下的路径，或省略让 CLI 写到测试环境的 artifacts/`
      ]
    }
  );
}
