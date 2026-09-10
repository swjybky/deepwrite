export class WebDavError extends Error {}

export function davError(status: number): Error {
  const messages: Record<number, string> = {
    401: "网盘账号或应用密码不正确。",
    403: "没有访问该同步目录的权限。",
    405: "服务器不支持所需的 WebDAV 操作。",
    413: "文件超过网盘允许的大小。",
    429: "网盘请求过于频繁，请稍后重试。",
    507: "网盘空间不足，请清理后重试。"
  };
  return new WebDavError(
    messages[status] ?? `网盘请求失败（${status}），请稍后重试。`
  );
}

export function davNetworkError(error: unknown): Error {
  if (error instanceof WebDavError) return error;
  // Inspect native codes internally; never return raw URLs or credential-bearing errors.
  let detail = "";
  for (let depth = 0; depth < 4 && error instanceof Error; depth++) {
    detail += ` ${error.message} ${Reflect.get(error, "code") ?? ""}`;
    error = error.cause;
  }
  const reasons: [RegExp, string][] = [
    [
      /ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/,
      "无法解析网盘服务器地址，请检查地址和 DNS 设置。"
    ],
    [
      /ERR_CERT_|ERR_SSL_|CERT_|SELF_SIGNED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/,
      "网盘安全证书验证失败，请检查服务器证书和系统时间。"
    ],
    [
      /ERR_PROXY_|ERR_TUNNEL_CONNECTION_FAILED|ERR_NO_SUPPORTED_PROXIES/,
      "无法通过代理连接网盘，请检查系统代理设置。"
    ],
    [
      /ERR_CONNECTION_(?:REFUSED|RESET|CLOSED)|ECONNREFUSED|ECONNRESET/,
      "网盘连接被拒绝或中断，请检查网络后重试。"
    ],
    [
      /TIMED_OUT|ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT/,
      "连接网盘超时，请重试。"
    ]
  ];
  return new WebDavError(
    reasons.find(([pattern]) => pattern.test(detail))?.[1] ??
      "无法连接网盘，请检查网络和服务器地址。"
  );
}
