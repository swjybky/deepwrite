const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "SOCKS_PROXY",
  "socks_proxy",
  "NODE_USE_ENV_PROXY"
] as const;

export type CapturedNodeHttpProxyEnv = Partial<
  Record<(typeof PROXY_ENV_KEYS)[number], string>
>;

export function captureNodeHttpProxyEnv(
  env: NodeJS.ProcessEnv = process.env
): CapturedNodeHttpProxyEnv {
  const captured: CapturedNodeHttpProxyEnv = {};
  for (const key of PROXY_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) captured[key] = value;
  }
  return captured;
}

export function disableNodeHttpProxyEnv(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const cleared: string[] = [];
  for (const key of PROXY_ENV_KEYS) {
    if (env[key] === undefined) continue;
    delete env[key];
    cleared.push(key);
  }
  return cleared;
}

export function restoreNodeHttpProxyEnv(
  captured: CapturedNodeHttpProxyEnv,
  env: NodeJS.ProcessEnv = process.env
): void {
  disableNodeHttpProxyEnv(env);
  for (const key of PROXY_ENV_KEYS) {
    const value = captured[key];
    if (value === undefined) continue;
    env[key] = value;
  }
}

export function applyNodeHttpProxyEnv(
  enabled: boolean,
  captured: CapturedNodeHttpProxyEnv,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (enabled) restoreNodeHttpProxyEnv(captured, env);
  else disableNodeHttpProxyEnv(env);
}

export function envWithoutNodeHttpProxy(
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const next = { ...env };
  disableNodeHttpProxyEnv(next);
  return next;
}
