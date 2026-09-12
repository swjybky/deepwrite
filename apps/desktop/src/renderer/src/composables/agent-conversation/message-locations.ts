const identities = new WeakMap<object, number>();
let nextIdentity = 0;
export function createMessageLocation(
  target: object,
  parent?: MessageLocation,
  key?: string | number
): MessageLocation {
  let identity = identities.get(target);
  if (identity === undefined) {
    identity = ++nextIdentity;
    identities.set(target, identity);
  }
  return {
    target,
    lineage: `${parent?.lineage ?? ""}/${identity}:${key ?? ""}`,
    ...(parent ? { parent } : {}),
    ...(key !== undefined ? { key } : {})
  };
}

export interface MessageLocation {
  target: object;
  lineage: string;
  parent?: MessageLocation;
  key?: string | number;
}

/** Resolve only the ancestors of the object being edited. Array entries can
 * move while a caller retains a reactive reference to the same object. */
export function resolveMessageLocation(
  location: MessageLocation,
  unwrap: (value: unknown) => unknown
): (string | number)[] | undefined {
  if (!location.parent) return [];
  const parent = resolveMessageLocation(location.parent, unwrap);
  if (!parent || location.key === undefined) return undefined;
  const container = location.parent.target;
  let key = location.key;
  if (Array.isArray(container)) {
    if (unwrap(Reflect.get(container, key)) !== location.target) {
      const index = container.findIndex(
        (value) => unwrap(value) === location.target
      );
      if (index < 0) return undefined;
      key = index;
    }
  } else if (unwrap(Reflect.get(container, key)) !== location.target)
    return undefined;
  return [...parent, key];
}
