import type { CloudBackupItemKind } from "@deepwrite/contracts";

export function catalogOpenDomain(
  kind: CloudBackupItemKind
): "book" | "material" | "skill" | null {
  if (kind === "book") return "book";
  if (kind === "material-library") return "material";
  if (kind === "skill-library") return "skill";
  return null;
}

export function catalogGroupDomain(
  kind: CloudBackupItemKind
): "material-group" | "skill-group" | null {
  if (kind === "material-group") return "material-group";
  if (kind === "skill-group") return "skill-group";
  return null;
}
