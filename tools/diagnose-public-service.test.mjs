import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  inspectArchive,
  readArchiveEntry
} from "./diagnostic-installation.mjs";
import {
  diagnose,
  safeError,
  probeModels
} from "./diagnose-public-service.mjs";
const roots = [];
const servers = [];

async function archive(baseUrl, version = "1.7.1") {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-network-diagnostic-"));
  roots.push(root);
  const main =
    baseUrl === undefined
      ? "const bundled = {};"
      : `const bundled = ${JSON.stringify({
          MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL: baseUrl,
          MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_KEY: "invalid-test-key"
        })}[name];`;
  const contents = [
    Buffer.from(JSON.stringify({ version })),
    Buffer.from(main)
  ];
  const json = Buffer.from(
    JSON.stringify({
      files: {
        "package.json": { size: contents[0].length, offset: "0" },
        out: {
          files: {
            main: {
              files: {
                "index.js": {
                  size: contents[1].length,
                  offset: String(contents[0].length)
                }
              }
            }
          }
        }
      }
    })
  );
  const header = Buffer.alloc(8 + Math.ceil(json.length / 4) * 4);
  header.writeUInt32LE(header.length - 4, 0);
  header.writeUInt32LE(json.length, 4);
  json.copy(header, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(header.length, 4);
  const file = join(root, "app.asar");
  await writeFile(file, Buffer.concat([size, header, ...contents]));
  return file;
}

async function server(handler) {
  const instance = createServer(handler);
  servers.push(instance);
  await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${instance.address().port}`;
}

afterEach(async () => {
  for (const instance of servers.splice(0)) {
    instance.closeAllConnections();
    await new Promise((resolve) => instance.close(resolve));
  }
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
});

describe("read-only installed public-service diagnostics", () => {
  it("reads a real bundled literal and the installed version without executing application code", async () => {
    const file = await archive("https://gateway.example.test");
    const inspection = inspectArchive(file);
    expect(inspection.version).toBe("1.7.1");
    expect(inspection.configured).toBe(true);
    expect(inspection.baseUrl.origin).toBe("https://gateway.example.test");
    expect(JSON.parse(readArchiveEntry(file, "package.json"))).toEqual({
      version: "1.7.1"
    });
  });

  it("reports an old unconfigured installation without trying a network request", async () => {
    const report = await diagnose(await archive(undefined, "1.7.0"));
    expect(report).toMatchObject({
      installedVersion: "1.7.0",
      bundledPublicServiceConfigured: false
    });
    expect(report).not.toHaveProperty("publicModels");
  });

  it("checks the public models endpoint with no credentials and keeps addresses out of the result", async () => {
    const baseUrl = await server((request, response) => {
      expect(request.url).toBe("/api/v1/public/models");
      expect(request.method).toBe("GET");
      expect(request.headers.authorization).toBeUndefined();
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "invalid-test-model" }] }));
    });
    const file = await archive(baseUrl);
    const before = await readFile(file);
    const report = await diagnose(file);
    expect(report).toMatchObject({
      dns: { resolved: true },
      publicModels: { connected: true, httpStatus: 200, modelCount: 1 }
    });
    expect(JSON.stringify(report)).not.toContain("127.0.0.1");
    expect(JSON.stringify(report)).not.toContain("invalid-test-key");
    expect(await readFile(file)).toEqual(before);
    expect(await readdir(roots.at(-1))).toEqual(["app.asar"]);
  });

  it("bounds response size without including a rejected server body in the report", async () => {
    const baseUrl = await server((_request, response) =>
      response.end(Buffer.alloc(3 * 1024 * 1024, "x"))
    );
    expect(await probeModels(new URL(baseUrl))).toEqual({
      connected: false,
      code: "UNKNOWN"
    });
  });

  it("rejects malformed and oversized archives without following external paths", async () => {
    const file = await archive("https://gateway.example.test");
    expect(() => readArchiveEntry(file, "../package.json")).toThrow(
      "Invalid entry"
    );
    await writeFile(file, Buffer.from([4, 0, 0, 0, 255, 255, 255, 127]));
    expect(() => inspectArchive(file)).toThrow("Invalid archive header");
    expect(await diagnose(file)).toMatchObject({ installationReadable: false });
  });

  it("returns only known error codes even when error messages contain private request details", () => {
    const failure = new Error(
      "https://gateway.example.test/?key=invalid-test-key",
      { cause: { code: "CERT_HAS_EXPIRED" } }
    );
    expect(safeError(failure)).toBe("CERT_HAS_EXPIRED");
    expect(safeError({ code: "invalid-test-secret" })).toBe("UNKNOWN");
  });
});
