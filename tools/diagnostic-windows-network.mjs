import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const STATUS_CODES = new Set([
  "NameResolutionFailure",
  "ProxyNameResolutionFailure",
  "ConnectFailure",
  "TrustFailure",
  "SecureChannelFailure",
  "Timeout",
  "ConnectionClosed",
  "ReceiveFailure",
  "SendFailure",
  "ProtocolError",
  "RequestCanceled",
  "UnknownError"
]);
const SCRIPT = `
$ErrorActionPreference = 'Stop'
$result = @{ transport = 'windows-dotnet-system' }
try {
  $settings = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue
  $result.manualProxyEnabled = [bool]$settings.ProxyEnable
  $result.proxyPacConfigured = [bool]$settings.AutoConfigURL
  $request = [Net.HttpWebRequest]::Create($env:DEEPWRITE_DIAGNOSTIC_TARGET)
  $request.Method = 'GET'
  $request.Timeout = 10000
  $request.ReadWriteTimeout = 10000
  $request.AllowAutoRedirect = $false
  $request.Accept = 'application/json'
  $response = $request.GetResponse()
  try { $result.httpStatus = [int]$response.StatusCode } finally { $response.Close() }
} catch {
  $webFailure = $_.Exception
  while ($webFailure -and !($webFailure -is [Net.WebException])) { $webFailure = $webFailure.InnerException }
  if ($webFailure) {
    $result.code = $webFailure.Status.ToString()
    if ($webFailure.Response) { $result.httpStatus = [int]$webFailure.Response.StatusCode; $webFailure.Response.Close() }
  } else { $result.code = 'UnknownError' }
}
$result | ConvertTo-Json -Compress
`;

async function probeWindowsNetwork(
  target,
  { platform = process.platform, execute = executeFile } = {}
) {
  if (platform !== "win32") return undefined;
  try {
    const { stdout } = await execute(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
      {
        env: { ...process.env, DEEPWRITE_DIAGNOSTIC_TARGET: String(target) },
        timeout: 15000,
        windowsHide: true,
        maxBuffer: 65536
      }
    );
    const data = JSON.parse(stdout.trim());
    return {
      transport: "windows-dotnet-system",
      ...(typeof data.manualProxyEnabled === "boolean"
        ? { manualProxyEnabled: data.manualProxyEnabled }
        : {}),
      ...(typeof data.proxyPacConfigured === "boolean"
        ? { proxyPacConfigured: data.proxyPacConfigured }
        : {}),
      ...(Number.isInteger(data.httpStatus) &&
      data.httpStatus >= 100 &&
      data.httpStatus <= 599
        ? { httpStatus: data.httpStatus }
        : {}),
      ...(STATUS_CODES.has(data.code) ? { code: data.code } : {})
    };
  } catch {
    return { transport: "windows-dotnet-system", code: "PROBE_UNAVAILABLE" };
  }
}

export { probeWindowsNetwork };
