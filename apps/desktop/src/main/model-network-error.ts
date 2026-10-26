import {
  classifyNetworkFailure,
  type NetworkFailureKind
} from "./network-failure";

const MESSAGES: Record<NetworkFailureKind, string> = {
  timeout: "拉取模型超时，请检查网络或代理设置后重试。",
  dns: "无法解析模型服务地址，请检查 DNS 或网络连接。",
  certificate: "模型服务安全证书校验失败，请检查系统时间、网络代理或证书设置。",
  proxy: "无法通过网络代理连接模型服务，请检查系统代理设置。",
  refused: "模型服务器拒绝了连接，请稍后重试。",
  interrupted: "与模型服务的连接意外中断，请检查网络后重试。",
  unknown: "无法连接模型服务，请检查网络、防火墙或代理设置后重试。"
};

export function describeModelNetworkError(error: unknown) {
  const failure = classifyNetworkFailure(error);
  const message = failure.localProxyRefused
    ? "无法连接本地网络代理，请检查代理是否已启动，或关闭网络代理后重试。"
    : MESSAGES[failure.kind];
  return {
    kind: failure.kind,
    message: failure.code ? `${message}（${failure.code}）` : message
  };
}
