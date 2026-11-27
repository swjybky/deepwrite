import { parseArgs } from "node:util";
import {
  CliError,
  EXIT_ERROR,
  EXIT_FAILED,
  EXIT_OK,
  failureResult,
  writeJson
} from "./output.mjs";
import { testLayout } from "./paths.mjs";

const GLOBAL_OPTIONS = {
  env: {
    type: "string",
    default: "default",
    description: "测试环境名，对应 ~/.deepwrite-test/<名>/"
  },
  help: { type: "boolean", description: "输出本命令的 JSON 说明" }
};

function optionHelp(options) {
  return Object.entries(options).map(([name, option]) => ({
    name: `--${name}`,
    type: option.type,
    ...(option.multiple ? { repeatable: true } : {}),
    ...(option.default !== undefined ? { default: option.default } : {}),
    description: option.description
  }));
}

function usage(groupName, commandName, command) {
  const options = Object.entries({ ...command.options, ...GLOBAL_OPTIONS })
    .filter(([name]) => name !== "help")
    .map(([name, option]) =>
      option.type === "boolean"
        ? `[--${name}]`
        : `[--${name} <${option.valueName ?? "值"}>]`
    );
  const positionals = (command.positionals ?? []).map(({ name, required }) =>
    required ? `<${name}>` : `[${name}]`
  );
  return [
    "pnpm -s ctl",
    groupName,
    commandName,
    ...positionals,
    ...options
  ].join(" ");
}

export function commandHelp(groupName, commandName, command) {
  return {
    usage: usage(groupName, commandName, command),
    summary: command.summary,
    description: command.description,
    ...(command.positionals ? { arguments: command.positionals } : {}),
    options: optionHelp({ ...command.options, ...GLOBAL_OPTIONS }),
    examples: command.examples,
    output: command.output,
    errors: command.errors
  };
}

function overview(groups) {
  return {
    usage: "pnpm -s ctl <组> <命令> [选项]",
    description:
      "DeepWrite 验证 CLI：在隔离的测试环境里启动开发版、调接口、看日志、灌测试数据。所有命令只输出一个 JSON 对象；退出码 0 成功、1 结果不通过、2 用法或环境错误。",
    groups: Object.entries(groups).map(([name, group]) => ({
      name,
      summary: group.summary,
      commands: Object.entries(group.commands).map(([command, definition]) => ({
        command: `${name} ${command}`,
        summary: definition.summary
      }))
    })),
    help: "pnpm -s ctl <组> <命令> --help 查看单个命令的参数、输出与错误码"
  };
}

function parseOptions(command, args, label) {
  const options = { ...command.options, ...GLOBAL_OPTIONS };
  const expected = command.positionals ?? [];
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: Object.fromEntries(
        Object.entries(options).map(([name, option]) => [
          name,
          {
            type: option.type,
            ...(option.multiple ? { multiple: true } : {}),
            ...(option.default !== undefined ? { default: option.default } : {})
          }
        ])
      ),
      allowPositionals: expected.length > 0,
      strict: true
    });
  } catch (error) {
    throw new CliError("cli.invalid_arguments", error.message, {
      nextSteps: [`运行 pnpm -s ctl ${label} --help 查看可用参数`]
    });
  }
  const missing = expected
    .slice(parsed.positionals.length)
    .find((argument) => argument.required);
  if (
    !parsed.values.help &&
    (missing || parsed.positionals.length > expected.length)
  ) {
    throw new CliError(
      "cli.invalid_arguments",
      missing
        ? `缺少参数 <${missing.name}>。`
        : `多余的参数：${parsed.positionals.slice(expected.length).join(" ")}`,
      { nextSteps: [`运行 pnpm -s ctl ${label} --help 查看用法`] }
    );
  }
  return {
    values: parsed.values,
    args: Object.fromEntries(
      expected.map((argument, index) => [
        argument.name,
        parsed.positionals[index]
      ])
    )
  };
}

export async function run(argv, groups, stream = process.stdout) {
  const startedAt = Date.now();
  const [groupName, commandName, ...rest] = argv;
  const label = [groupName, commandName].filter(Boolean).join(" ");
  try {
    if (!groupName || groupName === "help" || groupName === "--help") {
      writeJson({ ok: true, command: "help", data: overview(groups) }, stream);
      return EXIT_OK;
    }
    const group = groups[groupName];
    if (!group) {
      throw new CliError("cli.unknown_group", `没有命令组「${groupName}」。`, {
        nextSteps: ["运行 pnpm -s ctl help 查看全部命令"]
      });
    }
    if (!commandName || commandName === "--help") {
      writeJson(
        {
          ok: true,
          command: `${groupName} help`,
          data: {
            summary: group.summary,
            commands: Object.entries(group.commands).map(([name, command]) =>
              commandHelp(groupName, name, command)
            )
          }
        },
        stream
      );
      return EXIT_OK;
    }
    const command = group.commands[commandName];
    if (!command) {
      throw new CliError(
        "cli.unknown_command",
        `命令组「${groupName}」里没有「${commandName}」。`,
        { nextSteps: [`运行 pnpm -s ctl ${groupName} --help 查看本组命令`] }
      );
    }
    const { values, args } = parseOptions(command, rest, label);
    if (values.help) {
      writeJson(
        {
          ok: true,
          command: `${label} help`,
          data: commandHelp(groupName, commandName, command)
        },
        stream
      );
      return EXIT_OK;
    }
    const result = await command.run({
      values,
      args,
      layout: testLayout(values.env)
    });
    const ok = result.ok ?? true;
    writeJson(
      {
        ok,
        command: label,
        data: result.data,
        ...(result.artifacts ? { artifacts: result.artifacts } : {}),
        ...(result.nextSteps ? { nextSteps: result.nextSteps } : {}),
        durationMs: Date.now() - startedAt
      },
      stream
    );
    return ok ? EXIT_OK : EXIT_FAILED;
  } catch (error) {
    writeJson(failureResult(label || "help", error, startedAt), stream);
    return error instanceof CliError ? error.exitCode : EXIT_ERROR;
  }
}

export function secondsOption(value, name, fallback) {
  if (value === undefined) return fallback * 1_000;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new CliError("cli.invalid_arguments", `--${name} 必须是正数秒数。`, {
      nextSteps: [`例如 --${name} ${fallback}`]
    });
  }
  return seconds * 1_000;
}

export function jsonOption(value, name, fallback) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new CliError(
      "cli.invalid_arguments",
      `--${name} 不是合法的 JSON：${error.message}`,
      {
        nextSteps: [
          `例如 --${name} '{"workId":"..."}'，注意用单引号包住整段 JSON`
        ]
      }
    );
  }
}

export function countOption(value, name, fallback, max) {
  if (value === undefined) return fallback;
  const count = Number(value);
  if (!Number.isInteger(count) || count <= 0 || count > max) {
    throw new CliError(
      "cli.invalid_arguments",
      `--${name} 必须是 1 到 ${max} 之间的整数。`,
      { nextSteps: [`例如 --${name} ${fallback}`] }
    );
  }
  return count;
}
