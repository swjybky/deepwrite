const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function versionParts(version: string): {
  release: bigint[];
  prerelease: string[];
} {
  const separator = version.indexOf("-");
  const core = separator < 0 ? version : version.slice(0, separator);
  const release = core.split(".").map((part) => BigInt(part));
  // Historical 1.6.3xx builds preceded 1.6.4. Keep this exception local to
  // that release series; all other version segments use numeric ordering.
  if (/^1\.6\.3\d{2}$/.test(core)) {
    release.splice(2, 1, 3n, release[2]!);
  } else {
    release.push(0n);
  }
  return {
    release,
    prerelease: separator < 0 ? [] : version.slice(separator + 1).split(".")
  };
}

function comparePart(left: bigint | string, right: bigint | string): number {
  return left === right ? 0 : left > right ? 1 : -1;
}

export function compareVersions(left: string, right: string): number {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (
    !versionPattern.test(normalizedLeft) ||
    !versionPattern.test(normalizedRight)
  ) {
    throw new Error(`无法比较版本号：${left} / ${right}`);
  }
  const a = versionParts(normalizedLeft);
  const b = versionParts(normalizedRight);
  for (let index = 0; index < a.release.length; index += 1) {
    const order = comparePart(a.release[index]!, b.release[index]!);
    if (order) return order;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length ? -1 : 1;
  }
  for (
    let index = 0;
    index < Math.max(a.prerelease.length, b.prerelease.length);
    index += 1
  ) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    const order = aNumeric
      ? comparePart(BigInt(aPart), BigInt(bPart))
      : comparePart(aPart, bPart);
    if (order) return order;
  }
  return 0;
}
