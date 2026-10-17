import { prepareSmokeWorkspace } from "./smoke-workspace.mjs";
import { summarizeDecompositionTrialFailure } from "./decomposition-trial-diagnostic.mjs";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertElectronLaunchAllowed } from "../../../tools/electron-launch-environment.mjs";

assertElectronLaunchAllowed();

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const i18nOnly = process.argv.includes("--i18n-only");
const conversationOnly = process.argv.includes("--conversation-only");
const decompositionOnly = process.argv.includes("--decomposition-only");
const bookIdentityOnly = process.argv.includes("--book-identity-only");
const libraryGroupsOnly = process.argv.includes("--library-groups-only");
const decompositionRealModel = process.argv.includes(
  "--decomposition-real-model"
);
const workspaceRoot = resolve(appDir, "../..");
const electronDist =
  process.env.ELECTRON_OVERRIDE_DIST_PATH ||
  resolve(workspaceRoot, "node_modules/electron/dist");
const electronBinary =
  process.platform === "darwin"
    ? resolve(electronDist, "Electron.app/Contents/MacOS/Electron")
    : process.platform === "win32"
      ? resolve(electronDist, "electron.exe")
      : resolve(electronDist, "electron");

try {
  await access(resolve(appDir, "out/main/index.js"));
  await access(
    resolve(appDir, "out/main/utilities/conversation-storage/worker-entry.js")
  );
  await access(electronBinary);
} catch {
  console.error(
    "Desktop build or Electron binary is missing. Run `pnpm build` first."
  );
  process.exit(1);
}

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const hasXvfb =
  spawnSync("sh", ["-c", "command -v xvfb-run"], { encoding: "utf8" })
    .status === 0;
const smokeUserData = await realpath(
  await mkdtemp(join(tmpdir(), "deepwrite-electron-smoke-"))
);
await prepareSmokeWorkspace(smokeUserData);
const command = !hasDisplay && hasXvfb ? "xvfb-run" : electronBinary;
const args =
  !hasDisplay && hasXvfb
    ? [
        "-a",
        electronBinary,
        ".",
        `--user-data-dir=${smokeUserData}`,
        "--use-fake-device-for-media-stream"
      ]
    : [
        ".",
        `--user-data-dir=${smokeUserData}`,
        "--use-fake-device-for-media-stream"
      ];
if (process.platform === "darwin") args.push("--use-mock-keychain");

const child = spawn(command, args, {
  cwd: appDir,
  env: {
    ...process.env,
    DEEPWRITE_SMOKE: "1",
    DEEPWRITE_SMOKE_SUITE: libraryGroupsOnly
      ? "library-groups"
      : bookIdentityOnly
        ? "book-identity"
        : decompositionRealModel
          ? "decomposition-real-model"
          : decompositionOnly
            ? "decomposition"
            : conversationOnly
              ? "conversation"
              : i18nOnly
                ? "i18n"
                : "all",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(
  () => {
    child.kill("SIGKILL");
  },
  decompositionRealModel
    ? 1_800_000
    : decompositionOnly
      ? 240_000
      : bookIdentityOnly
        ? 120_000
        : // Voice UI steps tolerate slow cold starts on CI; keep the bound
          // generous enough for them to finish there.
          90_000
);

child.on("close", async (code) => {
  clearTimeout(timeout);
  await rm(smokeUserData, { recursive: true, force: true });
  const marker = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("DEEPWRITE_SMOKE_OK "));

  if (code !== 0 || !marker) {
    // Provider errors may echo request details; the real trial prints only status.
    console.error(
      decompositionRealModel
        ? "Real-model decomposition smoke did not complete."
        : output.trim()
    );
    if (decompositionRealModel)
      console.error(JSON.stringify(summarizeDecompositionTrialFailure(output)));
    console.error(`Electron smoke failed with exit code ${String(code)}.`);
    process.exit(1);
  }

  const summary = JSON.parse(marker.slice("DEEPWRITE_SMOKE_OK ".length));
  const localizationPassed =
    summary.localization?.status === "ok" &&
    summary.localization?.settings >= 14 &&
    summary.localization?.features >= 9 &&
    summary.localization?.switchedBothWays === true &&
    summary.localization?.restoredAfterReload === true &&
    summary.localization?.userContentUnchanged === true &&
    summary.localization?.layout === true;
  if (
    summary.health?.status !== "ok" ||
    summary.health?.workers?.length !== 3
  ) {
    console.error(
      `Electron smoke returned unhealthy utilities: ${JSON.stringify(summary)}`
    );
    process.exit(1);
  }

  if (libraryGroupsOnly) {
    if (
      summary.libraryGroups?.status !== "ok" ||
      summary.libraryGroups.groups !== 2 ||
      !summary.libraryGroups.menuOrder ||
      !summary.libraryGroups.canceled ||
      !summary.libraryGroups.membersDeleted
    ) {
      console.error(
        "Electron library group deletion smoke returned an invalid summary."
      );
      process.exit(1);
    }
    console.log(
      "Electron library group deletion smoke passed: both menus, cancellation, and group plus member deletion through Renderer, Preload, Main and Core."
    );
    return;
  }
  if (decompositionOnly || decompositionRealModel) {
    if (
      summary.decomposition?.status !== "ok" ||
      summary.decomposition?.modes?.length !==
        (decompositionRealModel ? 1 : 2) ||
      summary.decomposition?.runtime !==
        (decompositionRealModel ? "provider" : "local-faux") ||
      !(summary.decomposition?.targetEvents > 0) ||
      !(summary.decomposition?.outputEvents > 0) ||
      !(summary.decomposition?.childEvents > 0)
    ) {
      console.error(
        `Electron decomposition smoke returned an invalid summary: ${JSON.stringify(summary)}`
      );
      process.exit(1);
    }
    console.log(
      `Electron decomposition smoke passed: ${JSON.stringify(summary.decomposition)}`
    );
    if (!decompositionRealModel) {
      if (
        summary.decompositionUi?.status !== "ok" ||
        summary.decompositionUi?.views?.length !== 4
      )
        throw new Error("Decomposition UI smoke incomplete.");
      console.log(
        `Electron decomposition UI passed: ${JSON.stringify(summary.decompositionUi)}`
      );
    }
    return;
  }
  if (bookIdentityOnly) {
    const identity = summary.bookIdentity;
    if (
      identity?.status !== "ok" ||
      identity.runtime !== "local-faux" ||
      identity.rounds !== 3 ||
      !identity.titleAdopted ||
      !identity.renamed ||
      !identity.thumbnail ||
      !identity.composed ||
      !identity.coverAdopted ||
      !identity.persisted ||
      identity.updatedEvents < 6 ||
      identity.visuals?.status !== "ok" ||
      identity.visuals.captures?.length !== 11 ||
      identity.visuals.captures.filter(
        (capture) => capture.kind === "image-model-settings"
      ).length !== 1 ||
      identity.visuals.captures.filter((capture) => capture.kind === "page")
        .length !== 3 ||
      identity.visuals.captures.filter((capture) => capture.kind === "composer")
        .length !== 7
    ) {
      console.error(
        `Electron book identity smoke returned an invalid summary: ${JSON.stringify(summary)}`
      );
      process.exit(1);
    }
    console.log(
      `Electron book identity smoke passed: ${JSON.stringify(identity)}`
    );
    return;
  }
  if (i18nOnly) {
    if (!localizationPassed) {
      console.error("Electron language smoke returned an invalid summary.");
      process.exit(1);
    }
    console.log(
      "Electron language smoke passed: English settings and feature navigation, two-way switching, reload persistence and unchanged saved manuscripts."
    );
    return;
  }
  if (conversationOnly) {
    if (
      summary.conversation?.status !== "ok" ||
      summary.conversation?.archived !== true ||
      summary.conversation?.purged !== true
    ) {
      console.error("Electron conversation smoke returned an invalid summary.");
      process.exit(1);
    }
    console.log(
      "Electron conversation smoke passed: archive listing and permanent deletion crossed Renderer, Preload, Main, Core, and SQLite."
    );
    return;
  }
  if (
    summary.bookTemplates?.status !== "ok" ||
    summary.bookTemplates?.created !== 4 ||
    summary.extrasAgents?.status !== "ok" ||
    summary.extrasAgents?.runtime !== "local-faux" ||
    summary.extrasAgents?.styleResult !== true ||
    summary.extrasAgents?.longNote !== true ||
    summary.extrasAgents?.profileRoundTrip !== true ||
    summary.extrasAgents?.modelRequired !== true ||
    summary.extrasChat?.status !== "ok" ||
    summary.extrasChat?.runtime !== "local-faux" ||
    summary.extrasChat?.turns !== 2 ||
    summary.extrasChat?.roleplay !== true ||
    summary.extrasChat?.projectRejected !== true ||
    summary.contextCompaction?.status !== "ok" ||
    summary.contextCompaction?.workspace !== true ||
    summary.contextCompaction?.chat !== true ||
    summary.contextCompaction?.persisted !== true ||
    summary.contextCompaction?.coldRestore !== true ||
    summary.voice?.status !== "ok" ||
    summary.voice?.profiles !== 4 ||
    summary.voice?.isolatedUsage !== true ||
    summary.voice?.cancelled !== true ||
    summary.voice?.secretsHidden !== true ||
    summary.voiceUi?.status !== "ok" ||
    summary.voiceUi?.settingsTest !== true ||
    summary.voiceUi?.chatDraft !== true ||
    summary.voiceUi?.cancelled !== true ||
    !localizationPassed ||
    summary.agent?.status !== "ok" ||
    summary.agent?.runtime?.mode !== "local-faux" ||
    summary.agent?.deltaCount < 2 ||
    summary.agent?.thinkingDeltaCount < 1 ||
    summary.agent?.completed !== true ||
    summary.conversation?.status !== "ok" ||
    summary.conversation?.staged !== true ||
    summary.conversation?.reopened !== false ||
    !(summary.conversation?.chunkPages >= 2) ||
    !(summary.conversation?.metadataChunkPages >= 2) ||
    summary.conversation?.unknownRetained !== true ||
    summary.conversation?.proposalRetained !== true ||
    summary.conversation?.archived !== true ||
    summary.conversation?.purged !== true
  ) {
    console.error(
      `Electron smoke returned an invalid agent summary: ${JSON.stringify(summary)}`
    );
    process.exit(1);
  }

  console.log(
    "Electron smoke passed: healthy utilities, Pi/Faux completion, and Renderer-to-SQLite persistence; template CRUD; extras agents and chat; writing/chat compaction; MiMo/Ali voice profiles, real UI recording with a fake microphone, transcription, cancellation, secret protection and isolated usage; live language switching, English navigation, reload persistence and unchanged manuscripts."
  );
});
