interface Edit {
  start: number;
  end: number;
  lines: string[];
}

// Bounded LCS: pathological/very large rewrites are left for explicit review.
function edits(base: string[], next: string[]): Edit[] | null {
  let prefix = 0;
  while (
    prefix < base.length &&
    prefix < next.length &&
    base[prefix] === next[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < next.length - prefix &&
    base[base.length - suffix - 1] === next[next.length - suffix - 1]
  )
    suffix++;
  const a = base.slice(prefix, base.length - suffix);
  const b = next.slice(prefix, next.length - suffix);
  if (a.length * b.length > 2_000_000) return null;
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? 1 + (lengths[(i + 1) * width + j + 1] ?? 0)
          : Math.max(
              lengths[(i + 1) * width + j] ?? 0,
              lengths[i * width + j + 1] ?? 0
            );
    }
  const result: Edit[] = [];
  let current: Edit | null = null;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      if (current) result.push(current);
      current = null;
      i++;
      j++;
    } else {
      current ??= { start: prefix + i, end: prefix + i, lines: [] };
      if (
        j < b.length &&
        (i === a.length ||
          (lengths[i * width + j + 1] ?? 0) >=
            (lengths[(i + 1) * width + j] ?? 0))
      ) {
        current.lines.push(b[j] ?? "");
        j++;
      } else {
        i++;
        current.end = prefix + i;
      }
    }
  }
  if (current) result.push(current);
  return result;
}
export function mergeSyncText(
  base: string,
  local: string,
  remote: string
): string | null {
  if (local === remote || remote === base) return local;
  if (local === base) return remote;
  const lines = base.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const left = edits(lines, local.match(/[^\n]*\n|[^\n]+$/g) ?? []);
  const right = edits(lines, remote.match(/[^\n]*\n|[^\n]+$/g) ?? []);
  if (!left || !right) return null;
  const changes = [...left];
  for (const edit of right) {
    const overlap = changes.find(
      (entry) =>
        Math.max(entry.start, edit.start) < Math.min(entry.end, edit.end) ||
        (entry.start === entry.end &&
          entry.start >= edit.start &&
          entry.start <= edit.end) ||
        (edit.start === edit.end &&
          edit.start >= entry.start &&
          edit.start <= entry.end)
    );
    if (overlap) {
      if (
        overlap.start !== edit.start ||
        overlap.end !== edit.end ||
        overlap.lines.join("") !== edit.lines.join("")
      )
        return null;
    } else changes.push(edit);
  }
  changes.sort((a, b) => b.start - a.start);
  for (const edit of changes)
    lines.splice(edit.start, edit.end - edit.start, ...edit.lines);
  return lines.join("");
}
