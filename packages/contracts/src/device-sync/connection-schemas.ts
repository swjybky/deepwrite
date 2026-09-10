import { z } from "zod";

export const syncIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const syncHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const syncPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      !/[\\\u0000-\u001f:]/u.test(value) &&
      value
        .split("/")
        .every(
          (part) =>
            part.length > 0 &&
            part !== "." &&
            part !== ".." &&
            !["__proto__", "constructor", "prototype"].includes(part)
        )
  );
export const syncKindSchema = z.enum([
  "book",
  "long-book",
  "material-library",
  "skill-library",
  "material-group",
  "skill-group"
]);
export const syncConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.enum(["jianguoyun", "webdav"]),
    endpoint: z
      .string()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }),
    username: z.string().trim().min(1).max(512),
    directory: syncPathSchema.default("DeepWriteSync"),
    spaceId: syncIdSchema.nullable().default(null),
    deviceName: z.string().trim().min(1).max(80),
    excludedKeys: z.array(z.string().max(1024)).default([])
  })
  .strict();
export const syncJoinCodeSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("deepwrite.sync.join"),
    config: syncConfigSchema.pick({
      provider: true,
      endpoint: true,
      username: true,
      directory: true,
      spaceId: true
    })
  })
  .strict();
