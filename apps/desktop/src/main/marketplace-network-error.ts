import {
  classifyNetworkFailure,
  type NetworkFailureKind
} from "./network-failure";

const MESSAGES: Record<NetworkFailureKind, string> = {
  timeout: "连接技能广场超时，请检查网络或代理设置后重试。",
  dns: "无法解析技能广场服务器地址，请检查 DNS 或网络连接。",
  certificate: "技能广场安全证书校验失败，请检查系统时间、网络代理或证书设置。",
  proxy: "无法通过网络代理连接技能广场，请检查系统代理设置。",
  refused: "技能广场服务器拒绝了连接，请稍后重试。",
  interrupted: "与技能广场的连接意外中断，请检查网络后重试。",
  unknown: "无法连接技能广场，请检查网络、防火墙或代理设置后重试。"
};

export function describeMarketplaceNetworkError(error: unknown): {
  message: string;
} {
  return { message: MESSAGES[classifyNetworkFailure(error).kind] };
}
