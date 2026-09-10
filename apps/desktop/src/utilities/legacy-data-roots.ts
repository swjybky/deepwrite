export function legacyDataRootsFromEnvironment(): string[] {
  const encodedRoots = process.env.DEEPWRITE_LEGACY_DATA_ROOTS?.trim();
  if (encodedRoots) {
    try {
      const parsed = JSON.parse(encodedRoots) as unknown;
      if (Array.isArray(parsed)) {
        const roots = parsed.filter(
          (value): value is string =>
            typeof value === "string" && value.trim() !== ""
        );
        if (roots.length > 0) {
          return roots;
        }
      }
    } catch {
      // Fall back to the single-root environment variable for older launchers.
    }
  }
  const legacyDataRoot = process.env.DEEPWRITE_LEGACY_DATA_ROOT?.trim();
  return legacyDataRoot ? [legacyDataRoot] : [];
}
