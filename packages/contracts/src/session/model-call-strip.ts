/**
 * Lightweight runtime strip helper with zero Zod dependency so browser bundles
 * do not evaluate full session schemas merely to drop `snapshot`.
 */
export function stripModelCallSnapshot<T extends { snapshot?: unknown }>(
  call: T
): Omit<T, "snapshot"> {
  if (
    call.snapshot === undefined &&
    !Object.prototype.hasOwnProperty.call(call, "snapshot")
  ) {
    return call;
  }
  const { snapshot: _omitted, ...rest } = call;
  return rest;
}
