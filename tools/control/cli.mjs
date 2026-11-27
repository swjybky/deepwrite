import { cliGroups } from "./cli-groups.mjs";
import { run } from "./lib/runner.mjs";

process.exitCode = await run(process.argv.slice(2), cliGroups);
