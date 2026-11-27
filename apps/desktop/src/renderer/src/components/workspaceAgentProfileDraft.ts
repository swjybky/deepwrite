interface WorkspaceAgentProfileDraft {
  readAccess: { material: readonly string[]; skill: readonly string[] };
}

export function patchWorkspaceAgentReadAccess(
  draft: WorkspaceAgentProfileDraft | null,
  scope: "material" | "skill",
  id: string,
  checked: boolean
): void {
  if (!draft) return;
  const values = new Set(draft.readAccess[scope]);
  if (checked) values.add(id);
  else values.delete(id);
  Object.assign(draft.readAccess, { [scope]: [...values] });
}
