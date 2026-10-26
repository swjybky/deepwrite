import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { inspectArchive } from "./diagnostic-installation.mjs";
import { probeWindowsNetwork } from "./diagnostic-windows-network.mjs";

const SAFE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EACCES",
  "EPERM",
  "EPROTO",
  "ABORT_ERR",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
]);

function safeError(error) {
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current) && seen.size < 8) {
    seen.add(current);
    if (SAFE_CODES.has(current.code)) return current.code;
    current = current.cause;
  }
  return "UNKNOWN";
}

async function probeDns(hostname) {
  let timer;
  try {
    const addresses = await Promise.race([
      dns.lookup(hostname, { all: true }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })),
          8000
        );
      })
    ]);
    return {
      resolved: true,
      ipv4: addresses.filter((item) => item.family === 4).length,
      ipv6: addresses.filter((item) => item.family === 6).length
    };
  } catch (error) {
    return { resolved: false, code: safeError(error) };
  } finally {
    clearTimeout(timer);
  }
}

function probeModels(baseUrl) {
  const target = new URL(baseUrl);
  target.pathname =
    target.pathname.replace(/\/(?:v1|v1beta)\/?$/u, "").replace(/\/+$/u, "") +
    "/api/v1/public/models";
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    // No keys, redirects, proxy fallback, or relaxed certificate validation.
    const request = transport.get(
      target,
      {
        agent: false,
        rejectUnauthorized: true,
        signal: AbortSignal.timeout(12000),
        headers: { Accept: "application/json" }
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
          if (Buffer.byteLength(body) > 2 * 1024 * 1024)
            response.destroy(new Error("Response too large"));
        });
        response.on("error", (error) =>
          resolve({ connected: false, code: safeError(error) })
        );
        response.on("end", () => {
          let modelCount;
          try {
            const data = JSON.parse(body);
            if (Array.isArray(data.data)) modelCount = data.data.length;
          } catch {
            /* Only report status. */
          }
          resolve({
            connected: true,
            httpStatus: response.statusCode,
            ...(modelCount === undefined ? {} : { modelCount })
          });
        });
      }
    );
    request.on("error", (error) =>
      resolve({ connected: false, code: safeError(error) })
    );
  });
}

async function diagnose(archive) {
  const result = {
    expectedVersion: "1.7.1",
    checkedAtUtc: new Date().toISOString(),
    transport: "bundled-node-direct",
    platform: process.platform,
    runtimeVersion: process.versions.node
  };
  let installation;
  try {
    installation = inspectArchive(archive);
  } catch {
    return { ...result, installationReadable: false };
  }
  result.installationReadable = true;
  result.installedVersion = installation.version;
  result.bundledPublicServiceConfigured = installation.configured;
  if (installation.baseUrl) {
    const target = new URL(installation.baseUrl);
    target.pathname =
      target.pathname.replace(/\/(?:v1|v1beta)\/?$/u, "").replace(/\/+$/u, "") +
      "/api/v1/public/models";
    const [resolved, models, windows] = await Promise.all([
      probeDns(installation.baseUrl.hostname),
      probeModels(installation.baseUrl),
      probeWindowsNetwork(target)
    ]);
    result.dns = resolved;
    result.publicModels = models;
    if (windows) result.windowsSystemNetwork = windows;
  }
  return result;
}

export { safeError, probeModels, diagnose };

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const executable = process.argv[2];
  const outputDirectory =
    process.argv[3] || path.dirname(fileURLToPath(import.meta.url));
  if (
    !executable ||
    path.basename(executable).toLowerCase() !== "deepwrite.exe"
  ) {
    console.error(
      "DeepWrite.exe was not found. No application data was changed."
    );
    process.exitCode = 1;
  } else {
    const timeout = setTimeout(() => process.exit(2), 30000);
    diagnose(path.join(path.dirname(executable), "resources", "app.asar"))
      .then((result) => {
        const report = path.join(
          outputDirectory,
          `network-result-${Date.now()}.json`
        );
        fs.writeFileSync(report, JSON.stringify(result, null, 2) + "\n", {
          flag: "wx"
        });
        console.log(JSON.stringify(result, null, 2));
        console.log(
          "Diagnostic complete. Send the network-result JSON file back for review."
        );
        clearTimeout(timeout);
        process.exit(0);
      })
      .catch(() => {
        console.error(
          "Diagnostic could not complete. No application data was changed."
        );
        clearTimeout(timeout);
        process.exit(1);
      });
  }
}
