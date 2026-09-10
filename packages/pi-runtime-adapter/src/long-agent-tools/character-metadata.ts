import {
  LongWorkspaceOperationSchema,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation
} from "@deepwrite/contracts";

/** Entity metadata edits preserve all character files and references. */
export function characterMetadataOperations(
  index: LongWorkspaceIndexSnapshot,
  id: string,
  meta: Record<string, unknown>
): { operations: LongWorkspaceOperation[]; relocation?: string } {
  const character = index.characters.find((item) => item.id === id);
  if (!character) throw new Error(`人物 ${id} 不存在。`);
  const allowed = ["name", "aliases", "type_id"];
  if (Object.keys(meta).some((key) => !allowed.includes(key))) {
    throw new Error(`人物的 meta 只接受：${allowed.join("、")}。`);
  }
  const operations: LongWorkspaceOperation[] = [];
  const { type_id: typeId, ...patch } = meta;
  if (Object.keys(patch).length > 0) {
    const update = LongWorkspaceOperationSchema.parse({
      type: "character.update",
      id,
      patch
    });
    if (
      update.type === "character.update" &&
      ((update.patch.name !== undefined &&
        update.patch.name !== character.name) ||
        (update.patch.aliases !== undefined &&
          JSON.stringify(update.patch.aliases) !==
            JSON.stringify(character.aliases)))
    )
      operations.push(update);
  }
  if (typeId === undefined) return { operations };
  const targetType = index.characterTypes.find((item) => item.id === typeId);
  if (!targetType) throw new Error(`人物类型 ${String(typeId)} 不存在。`);
  if (character.group === targetType.id) return { operations };
  operations.push(
    LongWorkspaceOperationSchema.parse({
      type: "character.move",
      id,
      toGroup: targetType.id
    })
  );
  const sourceTitle =
    index.characterTypes.find((item) => item.id === character.group)?.title ??
    character.group;
  return { operations, relocation: `${sourceTitle} → ${targetType.title}` };
}
