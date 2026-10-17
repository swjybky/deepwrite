import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractArchPackage,
  validateArchMetadata
} from "../apps/desktop/scripts/verify-arch-package.mjs";

const version = "1.2.3";
const metadata = `pkgname = deepwrite\npkgver = ${version}-1\narch = x86_64\ndepend = dbus\ndepend = libsecret\ndepend = gtk3\ndepend = nss\n`;
const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("Arch package metadata", () => {
  it("accepts the current package with Linux keyring dependencies", () => {
    expect(() => validateArchMetadata(metadata, version)).not.toThrow();
  });
  it.each([
    [metadata.replace("pkgname = deepwrite", "pkgname = other"), "pkgname"],
    [metadata.replace("1.2.3-1", "1.2.2-1"), "pkgver"],
    [metadata.replace("x86_64", "aarch64"), "arch"],
    [metadata.replace("depend = libsecret\n", ""), "libsecret"],
    [metadata + "arch = x86_64\n", "arch"]
  ])("rejects incorrect or incomplete metadata", (source, field) => {
    expect(() => validateArchMetadata(source, version)).toThrow(field);
  });
});

describe("Arch package archive validation", () => {
  it("extracts actual archive contents and rejects an executable for another architecture", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-arch-fixture-"));
    roots.push(root);
    const source = join(root, "source");
    const extracted = join(root, "extracted");
    await mkdir(join(source, "opt/DeepWrite/resources"), { recursive: true });
    await mkdir(join(source, "usr/share/applications"), { recursive: true });
    await mkdir(extracted);
    const executable = Buffer.alloc(20);
    executable.write("\x7fELF", 0, "ascii");
    executable[4] = 2;
    executable[5] = 1;
    executable.writeUInt16LE(62, 18);
    await writeFile(join(source, ".PKGINFO"), metadata);
    await writeFile(join(source, "opt/DeepWrite/deepwrite"), executable);
    await writeFile(
      join(source, "opt/DeepWrite/resources/app.asar"),
      "invalid-test-asar"
    );
    await writeFile(
      join(source, "usr/share/applications/DeepWrite.desktop"),
      "[Desktop Entry]\n"
    );
    const artifact = join(root, "fixture.pkg.tar.xz");
    const archive = () => {
      const result = spawnSync(
        "tar",
        ["-cJf", "fixture.pkg.tar.xz", "-C", source, "."],
        {
          encoding: "utf8",
          cwd: root
        }
      );
      if (result.error || result.status !== 0)
        throw new Error(
          `Could not create Arch test fixture: ${result.error?.message ?? result.stderr}`
        );
    };
    archive();
    await expect(
      extractArchPackage(artifact, extracted, version)
    ).resolves.toBe(join(extracted, "opt/DeepWrite/deepwrite"));
    executable.writeUInt16LE(183, 18);
    await writeFile(join(source, "opt/DeepWrite/deepwrite"), executable);
    archive();
    await expect(
      extractArchPackage(artifact, extracted, version)
    ).rejects.toThrow("x86_64 ELF");
    await rm(join(source, "usr/share/applications/DeepWrite.desktop"));
    archive();
    await expect(
      extractArchPackage(artifact, extracted, version)
    ).rejects.toThrow("desktop entry");
    await rm(join(source, "opt/DeepWrite/resources/app.asar"));
    archive();
    await expect(
      extractArchPackage(artifact, extracted, version)
    ).rejects.toThrow("app.asar");
  });
});
