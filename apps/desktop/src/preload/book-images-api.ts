import {
  BookImagesPickInputSchema,
  BookImagesPickResultSchema,
  createEnvelope,
  type BookImagesApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";
export const bookImages: BookImagesApi = {
  async pick(raw) {
    const input = BookImagesPickInputSchema.parse(raw);
    const id = browserId("cmd_book_images_pick");
    return BookImagesPickResultSchema.parse(
      await invokeCommand(
        createEnvelope("bookImages.pick", input, {
          id,
          correlationId: id,
          context: { resourceId: input.book.projectId }
        })
      )
    );
  }
};
