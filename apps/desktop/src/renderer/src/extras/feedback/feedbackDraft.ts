import { ref } from "vue";
import type { FeedbackTag } from "@deepwrite/contracts";
import type { FeedbackDraftImage } from "./feedbackImage";

/** The draft and pending work survive closing and reopening the dialog. */
export const feedbackDraft = {
  tag: ref<FeedbackTag | undefined>(),
  content: ref(""),
  images: ref<FeedbackDraftImage[]>([]),
  submitting: ref(false),
  processingImages: ref(false),
  capturing: ref(false),
  reset(): void {
    this.tag.value = undefined;
    this.content.value = "";
    this.images.value = [];
  },
  snapshot() {
    return {
      tag: this.tag.value,
      content: this.content.value,
      images: [...this.images.value]
    };
  },
  clearIfUnchanged(snapshot: {
    tag: FeedbackTag | undefined;
    content: string;
    images: readonly FeedbackDraftImage[];
  }): boolean {
    if (
      this.processingImages.value ||
      this.tag.value !== snapshot.tag ||
      this.content.value !== snapshot.content ||
      this.images.value.length !== snapshot.images.length ||
      this.images.value.some(
        (image, index) => image.id !== snapshot.images[index]?.id
      )
    )
      return false;
    this.reset();
    return true;
  }
};
