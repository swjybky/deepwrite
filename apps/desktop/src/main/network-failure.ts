export type NetworkFailureKind =
  | "timeout"
  | "dns"
  | "certificate"
  | "proxy"
  | "refused"
  | "interrupted"
  | "unknown";

interface FailureRule {
  kind: NetworkFailureKind;
  codes: readonly string[];
  pattern: RegExp;
}

const RULES: readonly FailureRule[] = [
  {
    kind: "timeout",
    codes: [
      "ABORT_ERR",
      "ECONNABORTED",
      "ETIMEDOUT",
      "ERR_TIMED_OUT",
      "ERR_CONNECTION_TIMED_OUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT"
    ],
    pattern: /\b(?:timeout|timed out)\b|TimeoutError|AbortError/iu
  },
  {
    kind: "dns",
    codes: ["EAI_AGAIN", "ENOTFOUND", "ERR_NAME_NOT_RESOLVED"],
    pattern: /name_not_resolved|getaddrinfo|\bdns\b|resolve host/iu
  },
  {
    kind: "certificate",
    codes: [
      "CERT_HAS_EXPIRED",
      "CERT_NOT_YET_VALID",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "ERR_CERT_AUTHORITY_INVALID",
      "ERR_CERT_COMMON_NAME_INVALID",
      "ERR_CERT_DATE_INVALID",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    ],
    pattern: /certificate|self[ -]signed|cert_|tls cert/iu
  },
  {
    kind: "proxy",
    codes: [
      "ERR_PROXY_CONNECTION_FAILED",
      "ERR_TUNNEL_CONNECTION_FAILED",
      "UND_ERR_PROXY"
    ],
    pattern: /proxy|tunnel connection/iu
  },
  {
    kind: "refused",
    codes: ["ECONNREFUSED", "ERR_CONNECTION_REFUSED"],
    pattern: /connection refused/iu
  },
  {
    kind: "interrupted",
    codes: [
      "ECONNRESET",
      "EPIPE",
      "ERR_CONNECTION_CLOSED",
      "ERR_CONNECTION_RESET",
      "UND_ERR_SOCKET"
    ],
    pattern: /connection (?:closed|reset)|socket disconnected/iu
  }
];

function record(error: unknown): Record<string, unknown> | undefined {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : undefined;
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const visited = new Set<unknown>();
  const pending = [error];
  while (pending.length && chain.length < 8) {
    const current = pending.shift();
    if (current === undefined || current === null || visited.has(current))
      continue;
    visited.add(current);
    chain.push(current);
    pending.push(record(current)?.cause);
    if (current instanceof AggregateError)
      pending.push(...current.errors.slice(0, 8));
  }
  return chain;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  return typeof error === "string" ? error : "";
}

/** Return only a category and an allowlisted code, never a URL or raw message. */
export function classifyNetworkFailure(error: unknown): {
  kind: NetworkFailureKind;
  code?: string;
  localProxyRefused?: boolean;
} {
  const chain = errorChain(error);
  if (
    chain.some((entry) =>
      /ECONNREFUSED\s+(?:127\.0\.0\.1|\[?::1\]?|localhost):\d+/iu.test(
        errorText(entry)
      )
    )
  ) {
    return { kind: "proxy", code: "ECONNREFUSED", localProxyRefused: true };
  }
  for (const rule of RULES) {
    const code = rule.codes.find((candidate) =>
      chain.some(
        (entry) =>
          (typeof record(entry)?.code === "string" &&
            String(record(entry)?.code).toUpperCase() === candidate) ||
          new RegExp(`\\b${candidate}\\b`, "u").test(errorText(entry))
      )
    );
    if (code) return { kind: rule.kind, code };
  }
  for (const rule of RULES) {
    if (chain.some((entry) => rule.pattern.test(errorText(entry))))
      return { kind: rule.kind };
  }
  return { kind: "unknown" };
}
