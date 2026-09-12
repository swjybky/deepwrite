export class RendererStateSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RendererStateSerializationError";
  }
}

/** Compatibility inputs may omit undefined object fields, but never silently lose values. */
export function rendererStateJson(
  value: unknown,
  ancestors = new Set<object>()
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || ancestors.has(value))
    throw new RendererStateSerializationError(
      "Renderer state must contain finite JSON values without circular references."
    );
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    throw new RendererStateSerializationError(
      "Renderer state must contain only JSON arrays and plain objects."
    );
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value))
          throw new RendererStateSerializationError(
            "Renderer state must not contain array holes."
          );
        result.push(rendererStateJson(value[index], ancestors));
      }
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      Object.defineProperty(result, key, {
        value: rendererStateJson(child, ancestors),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
