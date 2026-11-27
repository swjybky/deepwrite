import type { Tool, TSchema } from "@earendil-works/pi-ai";
import { isRecord } from "@deepwrite/shared";

function isStrictCompatibleNode(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    ["anyOf", "oneOf", "allOf", "$ref", "not", "if", "then", "else"].some(
      (keyword) => Object.prototype.hasOwnProperty.call(value, keyword)
    )
  ) {
    return false;
  }

  if (value.type === "object") {
    if (value.additionalProperties !== false) return false;
    const properties = value.properties;
    if (!isRecord(properties)) return false;
    const propertyNames = Object.keys(properties);
    const required = new Set(
      Array.isArray(value.required)
        ? value.required.filter(
            (item): item is string => typeof item === "string"
          )
        : []
    );
    if (propertyNames.some((name) => !required.has(name))) return false;
    return Object.values(properties).every(isStrictCompatibleNode);
  }

  if (value.type === "array") {
    return isStrictCompatibleNode(value.items);
  }

  return (
    value.type === "string" ||
    value.type === "number" ||
    value.type === "integer" ||
    value.type === "boolean" ||
    value.type === "null"
  );
}

export function supportsPiStrictToolSchema(schema: TSchema): boolean {
  return isStrictCompatibleNode(schema);
}

export function piStrictToolSampling(
  schema: TSchema
): Pick<Tool, "constrainedSampling"> | Record<string, never> {
  return supportsPiStrictToolSchema(schema)
    ? {
        constrainedSampling: {
          type: "json_schema",
          strict: "prefer"
        }
      }
    : {};
}
