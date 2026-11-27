import { join } from "node:path";
import { CliError } from "./output.mjs";
import { REPO_ROOT } from "./paths.mjs";

const TOOLS_SOURCE = join(
  REPO_ROOT,
  "packages/contracts/src/external-control/tools.ts"
);

/** Read from the contract source, so the list matches the code being verified. */
export async function loadToolCatalog() {
  try {
    const { runnerImport } = await import("vite");
    const { module } = await runnerImport(TOOLS_SOURCE, {
      configFile: false,
      logLevel: "silent",
      root: REPO_ROOT
    });
    return module.EXTERNAL_CONTROL_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      readOnly: tool.annotations.readOnlyHint,
      inputSchema: module.externalControlToolInputJsonSchema(tool)
    }));
  } catch (error) {
    throw new CliError(
      "app.tool_catalog_failed",
      `读取工具契约失败：${error.message}`,
      {
        nextSteps: [
          "运行 pnpm install 确认依赖完整",
          `检查 ${TOOLS_SOURCE} 能否通过类型检查`
        ]
      }
    );
  }
}
