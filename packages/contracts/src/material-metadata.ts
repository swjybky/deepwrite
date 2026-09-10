import { z } from "zod";
import {
  MATERIAL_DESCRIPTION_PREVIEW_LENGTH,
  MATERIAL_NAME_PREVIEW_LENGTH
} from "./material-markdown";

export const MaterialMetadataSchema = z.object({
  name: z.string().max(MATERIAL_NAME_PREVIEW_LENGTH),
  description: z.string().max(MATERIAL_DESCRIPTION_PREVIEW_LENGTH),
  nameSource: z.enum(["configured", "title", "id"]),
  descriptionSource: z.enum(["configured", "excerpt", "fallback"])
});
