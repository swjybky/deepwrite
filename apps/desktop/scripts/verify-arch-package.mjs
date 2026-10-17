import { spawnSync } from "node:child_process";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { assertElectronLaunchAllowed } from "../../../tools/electron-launch-environment.mjs";
import { verifyPackagedRuntime } from "./package-runtime-files.mjs";
import {
  runPackagedSmoke,
  validateSmokeSummary
} from "./package-smoke-runner.mjs";

export function validateArchMetadata(source, version) {
  const fields = new Map();
  for (const line of source.split(/\r?\n/u)) {
    const match = /^([a-z]+) = (.+)$/u.exec(line);
    if (match)
      fields.set(match[1], [...(fields.get(match[1]) ?? []), match[2]]);
  }
  const expected = {
    pkgname: "deepwrite",
    pkgver: `${version}-1`,
    arch: "x86_64"
  };
  for (const [key, value] of Object.entries(expected)) {
    if (fields.get(key)?.length !== 1 || fields.get(key)[0] !== value)
      throw new Error(`Invalid Arch package ${key}; expected ${value}`);
  }
  for (const dependency of ["dbus", "libsecret", "gtk3", "nss"]) {
    if (!fields.get("depend")?.includes(dependency))
      throw new Error(`Arch package is missing dependency: ${dependency}`);
  }
}

function tar(args, cwd) {
  const result = spawnSync("tar", args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Arch archive verification failed: ${result.error?.message ?? result.stderr}`
    );
  return result.stdout;
}

export async function extractArchPackage(artifact, directory, version) {
  // GNU tar interprets Windows drive letters as remote archive hosts.
  const archive = resolve(artifact);
  const archiveDirectory = dirname(archive);
  const entries = tar(["-tf", basename(archive)], archiveDirectory)
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//u, ""));
  if (
    entries.some(
      (entry) => entry.startsWith("/") || entry.split("/").includes("..")
    )
  )
    throw new Error("Arch archive contains an unsafe path");
  for (const required of [
    ".PKGINFO",
    "opt/DeepWrite/deepwrite",
    "opt/DeepWrite/resources/app.asar"
  ]) {
    if (!entries.includes(required))
      throw new Error(`Arch archive is missing ${required}`);
  }
  if (
    !entries.some((entry) =>
      /^usr\/share\/applications\/[^/]+\.desktop$/u.test(entry)
    )
  )
    throw new Error("Arch archive is missing its desktop entry");
  tar(["-xf", basename(archive), "-C", resolve(directory)], archiveDirectory);
  validateArchMetadata(
    await readFile(join(directory, ".PKGINFO"), "utf8"),
    version
  );
  const executable = join(directory, "opt/DeepWrite/deepwrite");
  const header = Buffer.alloc(20);
  const handle = await open(executable, "r");
  let bytesRead;
  try {
    ({ bytesRead } = await handle.read(header, 0, header.length, 0));
  } finally {
    await handle.close();
  }
  if (
    bytesRead < 20 ||
    header.toString("hex", 0, 4) !== "7f454c46" ||
    header[4] !== 2 ||
    header[5] !== 1 ||
    header.readUInt16LE(18) !== 62
  )
    throw new Error("Arch package executable is not Linux x86_64 ELF");
  return executable;
}

export async function verifyArchTestPackage(
  releaseDir,
  version,
  { smoke = true } = {}
) {
  const canRun = process.platform === "linux" && process.arch === "x64";
  if (canRun && smoke) assertElectronLaunchAllowed();
  const artifact = join(
    releaseDir,
    `DeepWrite-${version}-linux-x64-test.pkg.tar.xz`
  );
  const info = await stat(artifact);
  if (!info.isFile() || info.size === 0)
    throw new Error(`Arch package is missing or empty: ${artifact}`);
  const temporary = await mkdtemp(join(tmpdir(), "deepwrite-arch-package-"));
  try {
    const executable = await extractArchPackage(artifact, temporary, version);
    const inventory = verifyPackagedRuntime(
      join(temporary, "opt/DeepWrite/resources/app.asar")
    );
    console.log(
      `PACKAGE_ARCH_CONTENTS_OK entries=${inventory.entries} bytes=${info.size} artifact=${artifact}`
    );
    if (!smoke) return;
    if (!canRun) {
      console.log(
        `PACKAGE_SMOKE_SKIPPED target=arch-x64 host=${process.platform}-${process.arch} reason=host artifact=${artifact}`
      );
      return;
    }
    const profile = await mkdtemp(join(tmpdir(), "deepwrite-arch-profile-"));
    try {
      for (const reopened of [false, true]) {
        const summary = await runPackagedSmoke(
          executable,
          temporary,
          profile,
          "linux"
        );
        validateSmokeSummary(summary, reopened);
        console.log(`PACKAGE_ARCH_SMOKE_OK reopened=${reopened}`);
      }
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
    console.log(
      `PACKAGE_TEST_OK target=arch-x64 bytes=${info.size} artifact=${artifact}`
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
