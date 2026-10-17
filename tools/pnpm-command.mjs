/** Launch pnpm's JS CLI directly: Node cannot spawn Windows .cmd shims without a shell. */
export function pnpmInvocation(
  args,
  {
    platform = process.platform,
    execPath = process.execPath,
    npmExecPath = process.env.npm_execpath
  } = {}
) {
  if (npmExecPath && /\.[cm]?js$/iu.test(npmExecPath))
    return { command: execPath, args: [npmExecPath, ...args] };
  if (platform === "win32")
    throw new Error(
      "Run packaging through pnpm pack:test:* so the pnpm CLI path is available."
    );
  return { command: "pnpm", args };
}
