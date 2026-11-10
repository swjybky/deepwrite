/**
 * Three-way revert of one committed batch: `before` and `after` are the index
 * around that batch, `current` is the index now. Only what the batch changed
 * is undone, and only where later work has not changed it again; everything
 * else stays as it is now. Any overlap is reported instead of overwritten.
 */
type JsonObject = { [key: string]: JsonValue };
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type Slot = JsonValue | undefined;

export interface RevertResult {
  value: Slot;
  conflicts: string[];
}

/** Write timestamps follow every save; they never decide a conflict. */
const VOLATILE_KEYS = new Set(["updatedAt"]);
/**
 * Positions are renumbered after the merge, so a shift caused by another
 * insertion or deletion is not a conflict. A reorder is still undone while
 * the batch's value is in place.
 */
const POSITION_KEYS = [
  "order",
  "narrativeOrder",
  "storyOrder",
  "orderInChapter"
];
const POSITION_KEY_SET = new Set(POSITION_KEYS);
const POSITION_GROUP_KEYS = [
  undefined,
  "volumeId",
  "arcId",
  "group",
  "chapterCardId"
] as const;

function isObject(value: Slot): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sameJson(left: Slot, right: Slot): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => sameJson(item, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (VOLATILE_KEYS.has(key) || POSITION_KEY_SET.has(key)) continue;
    if (!sameJson(left[key], right[key])) return false;
  }
  return true;
}

/** Arrays whose members carry a stable identity merge member by member. */
function memberKey(item: JsonValue): string | undefined {
  if (typeof item === "string") return `s:${item}`;
  if (isObject(item) && typeof item.id === "string") return `o:${item.id}`;
  return undefined;
}

function keyedMembers(
  values: readonly JsonValue[]
): Map<string, JsonValue> | undefined {
  const members = new Map<string, JsonValue>();
  for (const item of values) {
    const key = memberKey(item);
    if (key === undefined || members.has(key)) return undefined;
    members.set(key, item);
  }
  return members;
}

function label(key: string): string {
  return key.slice(2);
}

function revertKeyedArray(
  current: JsonValue[],
  before: JsonValue[],
  after: JsonValue[],
  path: string,
  conflicts: string[]
): JsonValue[] | undefined {
  const beforeMembers = keyedMembers(before);
  const afterMembers = keyedMembers(after);
  const currentMembers = keyedMembers(current);
  if (!beforeMembers || !afterMembers || !currentMembers) return undefined;

  const result = new Map<string, JsonValue>(currentMembers);
  const order = [...currentMembers.keys()];
  const restored = new Set<string>();

  for (const [key, created] of afterMembers) {
    if (beforeMembers.has(key)) continue;
    const now = result.get(key);
    if (now === undefined) continue;
    if (sameJson(now, created)) {
      result.delete(key);
      order.splice(order.indexOf(key), 1);
    } else {
      conflicts.push(`${path}[${label(key)}] 在之后又被修改`);
    }
  }

  for (const [key, beforeItem] of beforeMembers) {
    const afterItem = afterMembers.get(key);
    const now = result.get(key);
    if (afterItem === undefined) {
      if (now !== undefined) {
        if (!sameJson(now, beforeItem)) {
          conflicts.push(`${path}[${label(key)}] 已被重新创建`);
        }
        continue;
      }
      result.set(key, beforeItem);
      restored.add(key);
      order.splice(
        insertionIndex(order, [...beforeMembers.keys()], key),
        0,
        key
      );
      continue;
    }
    if (sameJson(beforeItem, afterItem)) continue;
    if (now === undefined) {
      conflicts.push(`${path}[${label(key)}] 在之后被删除`);
      continue;
    }
    const reverted = revertValue(
      now,
      beforeItem,
      afterItem,
      `${path}[${label(key)}]`,
      conflicts
    );
    if (reverted !== undefined) result.set(key, reverted);
  }

  restoreRelativeOrder(
    order,
    [...beforeMembers.keys()],
    [...afterMembers.keys()]
  );
  const merged = order.map((key) => ({ key, value: result.get(key)! }));
  for (const positionKey of POSITION_KEYS) {
    renumberPositions(merged, positionKey, restored, [current, before, after]);
  }
  return merged.map(({ value }) => value);
}

function positionOf(item: JsonValue, positionKey: string): number | undefined {
  if (!isObject(item)) return undefined;
  const value = item[positionKey];
  return Number.isInteger(value) ? (value as number) : undefined;
}

function groupOf(item: JsonValue, groupKey: string | undefined): string {
  if (groupKey === undefined || !isObject(item)) return "";
  return JSON.stringify(item[groupKey] ?? null);
}

function contiguousWithin(
  values: readonly JsonValue[],
  positionKey: string,
  groupKey: string | undefined
): boolean {
  const groups = new Map<string, number[]>();
  for (const item of values) {
    const position = positionOf(item, positionKey);
    if (position === undefined) return false;
    const group = groupOf(item, groupKey);
    groups.set(group, [...(groups.get(group) ?? []), position]);
  }
  return [...groups.values()].every((positions) =>
    positions
      .sort((left, right) => left - right)
      .every((position, index) => position === index + 1)
  );
}

/**
 * Restore contiguous 1..n numbering. The grouping is the first one under
 * which every input array was already contiguous, so it follows the data
 * instead of a hard-coded schema. A restored member wins a tie and therefore
 * returns to its original slot.
 */
function renumberPositions(
  merged: { key: string; value: JsonValue }[],
  positionKey: string,
  restored: ReadonlySet<string>,
  inputs: readonly (readonly JsonValue[])[]
): void {
  if (!merged.length) return;
  if (
    merged.some(({ value }) => positionOf(value, positionKey) === undefined)
  ) {
    return;
  }
  const groupIndex = POSITION_GROUP_KEYS.findIndex((candidate) =>
    inputs.every((values) => contiguousWithin(values, positionKey, candidate))
  );
  if (groupIndex < 0) return;
  const groupKey = POSITION_GROUP_KEYS[groupIndex];
  const groups = new Map<string, { key: string; value: JsonValue }[]>();
  for (const entry of merged) {
    const group = groupOf(entry.value, groupKey);
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }
  for (const entries of groups.values()) {
    const ranked = entries
      .map((entry, index) => ({ entry, index }))
      .sort(
        (left, right) =>
          positionOf(left.entry.value, positionKey)! -
            positionOf(right.entry.value, positionKey)! ||
          Number(restored.has(right.entry.key)) -
            Number(restored.has(left.entry.key)) ||
          left.index - right.index
      );
    ranked.forEach(({ entry }, index) => {
      const value = entry.value as JsonObject;
      if (value[positionKey] !== index + 1) {
        entry.value = { ...value, [positionKey]: index + 1 };
      }
    });
  }
}

/** Place a restored member after its nearest surviving predecessor. */
function insertionIndex(
  order: readonly string[],
  beforeOrder: readonly string[],
  key: string
): number {
  const position = beforeOrder.indexOf(key);
  for (let index = position - 1; index >= 0; index -= 1) {
    const found = order.indexOf(beforeOrder[index]!);
    if (found >= 0) return found + 1;
  }
  for (let index = position + 1; index < beforeOrder.length; index += 1) {
    const found = order.indexOf(beforeOrder[index]!);
    if (found >= 0) return found;
  }
  return 0;
}

/** Undo a reordering only while the batch's order is still in place. */
function restoreRelativeOrder(
  order: string[],
  beforeOrder: readonly string[],
  afterOrder: readonly string[]
): void {
  const shared = new Set(
    beforeOrder.filter((key) => afterOrder.includes(key) && order.includes(key))
  );
  const pick = (keys: readonly string[]) =>
    keys.filter((key) => shared.has(key));
  const wanted = pick(beforeOrder);
  const changed = pick(afterOrder);
  const now = pick(order);
  if (sameJson(wanted, changed) || !sameJson(now, changed)) return;
  let next = 0;
  for (let index = 0; index < order.length; index += 1) {
    if (shared.has(order[index]!)) order[index] = wanted[next++]!;
  }
}

function revertValue(
  current: Slot,
  before: Slot,
  after: Slot,
  path: string,
  conflicts: string[]
): Slot {
  if (sameJson(before, after)) return current;
  if (sameJson(current, after)) return before;
  if (sameJson(current, before)) return current;
  if (Array.isArray(current) && Array.isArray(before) && Array.isArray(after)) {
    const merged = revertKeyedArray(current, before, after, path, conflicts);
    if (merged) return merged;
  } else if (isObject(current) && isObject(before) && isObject(after)) {
    const result: JsonObject = {};
    const keys = new Set([
      ...Object.keys(current),
      ...Object.keys(before),
      ...Object.keys(after)
    ]);
    for (const key of keys) {
      const value = VOLATILE_KEYS.has(key)
        ? current[key]
        : POSITION_KEY_SET.has(key)
          ? current[key] === after[key] && before[key] !== undefined
            ? before[key]
            : current[key]
          : revertValue(
              current[key],
              before[key],
              after[key],
              `${path}.${key}`,
              conflicts
            );
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  conflicts.push(`${path} 在之后又被修改`);
  return current;
}

export function revertJson(
  current: unknown,
  before: unknown,
  after: unknown
): RevertResult {
  const conflicts: string[] = [];
  const value = revertValue(
    current as Slot,
    before as Slot,
    after as Slot,
    "$",
    conflicts
  );
  return { value, conflicts };
}
