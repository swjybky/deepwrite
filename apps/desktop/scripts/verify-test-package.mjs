import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyPackagedRuntime } from "./package-runtime-files.mjs";
import {
  runPackagedSmoke,
  validateSmokeSummary
} from "./package-smoke-runner.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const releaseDir = join(appDir, "release");
const [targetPlatform, targetArch] = process.argv.slice(2);

if (!(
  (targetPlatform === "mac" &&
    (targetArch === "arm64" || targetArch === "x64")) ||
  (targetPlatform === "linux" && targetArch === "x64") ||
  (targetPlatform === "win" && targetArch === "x64")
)) {
  console.error(
    "Usage: node scripts/verify-test-package.mjs <linux x64|mac arm64|mac x64|win x64>"
  );
  process.exit(1);
}

const packageJson = JSON.parse(
  await readFile(join(appDir, "package.json"), "utf8")
);
const extension =
  targetPlatform === "mac" ? "dmg" : targetPlatform === "linux" ? "deb" : "exe";
const artifactArch =
  targetPlatform === "linux" && targetArch === "x64" ? "amd64" : targetArch;
const artifact = join(
  releaseDir,
  `DeepWrite-${packageJson.version}-${targetPlatform}-${artifactArch}-test.${extension}`
);
const artifactStat = await stat(artifact);
if (!artifactStat.isFile() || artifactStat.size === 0) {
  throw new Error(`Test package is missing or empty: ${artifact}`);
}

if (targetPlatform === "linux") {
  const appImage = join(
    releaseDir,
    `DeepWrite-${packageJson.version}-linux-x86_64-test.AppImage`
  );
  const appImageStat = await stat(appImage);
  if (!appImageStat.isFile() || appImageStat.size === 0) {
    throw new Error(`Test package is missing or empty: ${appImage}`);
  }
}

if (targetPlatform === "mac") {
  const verification = spawnSync("hdiutil", ["verify", artifact], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (verification.status !== 0) {
    throw new Error(
      `DMG verification failed:\n${verification.stderr || verification.stdout}`
    );
  }

  const appBundle = join(
    releaseDir,
    targetArch === "arm64" ? "mac-arm64" : "mac",
    "DeepWrite.app"
  );
  await stat(appBundle);

  const signatureVerification = spawnSync(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=4", appBundle],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    }
  );
  if (signatureVerification.status !== 0) {
    throw new Error(
      `Ad-hoc signature verification failed:\n${signatureVerification.stderr || signatureVerification.stdout}`
    );
  }

  const signatureDetails = spawnSync(
    "codesign",
    ["-d", "--verbose=4", appBundle],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    }
  );
  const signatureOutput = `${signatureDetails.stdout || ""}\n${signatureDetails.stderr || ""}`;
  if (
    signatureDetails.status !== 0 ||
    !signatureOutput.includes("Signature=adhoc")
  ) {
    throw new Error(
      `Expected an ad-hoc signed app bundle:\n${signatureOutput}`
    );
  }
}

const unpackedDirectory = join(
  releaseDir,
  targetPlatform === "mac"
    ? targetArch === "arm64"
      ? "mac-arm64"
      : "mac"
    : `${targetPlatform === "win" ? "win" : "linux"}-unpacked`
);
const resources =
  targetPlatform === "mac"
    ? join(unpackedDirectory, "DeepWrite.app", "Contents", "Resources")
    : join(unpackedDirectory, "resources");
const inventory = verifyPackagedRuntime(join(resources, "app.asar"));
console.log(
  `PACKAGE_RUNTIME_FILES_OK entries=${inventory.entries} checkedModules=${inventory.checkedModules}`
);

const hostCanRunTarget =
  (targetPlatform === "mac" && process.platform === "darwin") ||
  (targetPlatform === "linux" && process.platform === "linux") ||
  (targetPlatform === "win" && process.platform === "win32");

if (!hostCanRunTarget) {
  console.log(
    `PACKAGE_SMOKE_SKIPPED target=${targetPlatform}-${targetArch} host=${process.platform}-${process.arch} artifact=${artifact}`
  );
  process.exit(0);
}

let executable =
  targetPlatform === "mac"
    ? join(
        releaseDir,
        targetArch === "arm64" ? "mac-arm64" : "mac",
        "DeepWrite.app",
        "Contents",
        "MacOS",
        "DeepWrite"
      )
    : targetPlatform === "linux"
      ? join(releaseDir, "linux-unpacked", "deepwrite")
      : join(releaseDir, "win-unpacked", "DeepWrite.exe");
await stat(executable);

const smokeUserData = await mkdtemp(
  join(tmpdir(), "deepwrite-packaged-smoke-")
);
let mountPoint;
let mounted = false;
const failures = [];
try {
  if (targetPlatform === "mac") {
    const quarantine = spawnSync(
      "xattr",
      ["-p", "com.apple.quarantine", artifact],
      { encoding: "utf8" }
    );
    if (quarantine.status === 0) {
      const cleared = spawnSync(
        "xattr",
        ["-d", "com.apple.quarantine", artifact],
        { encoding: "utf8" }
      );
      if (cleared.status !== 0)
        throw new Error(
          `Cannot clear stale quarantine from test artifact: ${cleared.stderr}`
        );
    }
    mountPoint = await mkdtemp(join(tmpdir(), "deepwrite-package-mount-"));
    const attach = spawnSync(
      "hdiutil",
      [
        "attach",
        "-quiet",
        "-readonly",
        "-nobrowse",
        "-mountpoint",
        mountPoint,
        artifact
      ],
      { encoding: "utf8", timeout: 60_000 }
    );
    if (attach.status !== 0)
      throw new Error(
        `Cannot mount test DMG: ${attach.stderr || attach.stdout}`
      );
    mounted = true;
    const mountedApp = join(mountPoint, "DeepWrite.app");
    const signature = spawnSync(
      "codesign",
      ["--verify", "--deep", "--strict", mountedApp],
      { encoding: "utf8" }
    );
    if (signature.status !== 0)
      throw new Error(`Mounted app signature failed: ${signature.stderr}`);
    verifyPackagedRuntime(
      join(mountedApp, "Contents", "Resources", "app.asar")
    );
    executable = join(mountedApp, "Contents", "MacOS", "DeepWrite");
  }
  for (const reopened of [false, true]) {
    const summary = await runPackagedSmoke(
      executable,
      appDir,
      smokeUserData,
      targetPlatform
    );
    validateSmokeSummary(summary, reopened);
    console.log(
      `PACKAGE_CONVERSATION_SMOKE_OK reopened=${reopened} chunkPages=${summary.conversation.chunkPages} metadataChunkPages=${summary.conversation.metadataChunkPages}`
    );
  }
} catch (error) {
  failures.push(error);
} finally {
  await rm(smokeUserData, { recursive: true, force: true }).catch((error) =>
    failures.push(error)
  );
  if (mounted) {
    const detach = spawnSync("hdiutil", ["detach", "-quiet", mountPoint], {
      encoding: "utf8",
      timeout: 60_000
    });
    if (detach.status !== 0)
      failures.push(
        new Error(`Cannot detach test DMG at ${mountPoint}: ${detach.stderr}`)
      );
    else mounted = false;
  }
  if (mountPoint && !mounted)
    await rm(mountPoint, { recursive: true, force: true }).catch((error) =>
      failures.push(error)
    );
}
if (failures.length)
  throw new AggregateError(
    failures,
    "Packaged application verification failed."
  );
console.log(
  `PACKAGE_TEST_OK target=${targetPlatform}-${targetArch} bytes=${artifactStat.size} artifact=${artifact}`
);
