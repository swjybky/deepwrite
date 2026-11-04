import { ipcRenderer } from "electron";
import * as C from "@deepwrite/contracts";

const invokeFeedback = (request: unknown): Promise<unknown> =>
  ipcRenderer.invoke(
    C.FEEDBACK_IPC_CHANNEL,
    C.FeedbackIpcRequestSchema.parse(request)
  );

export const feedback: C.DeepWriteApi["feedback"] = {
  async list(filter = {}) {
    return C.FeedbackPageSchema.parse(
      await invokeFeedback({ operation: "list", filter })
    );
  },
  async submit(input) {
    return C.FeedbackItemSchema.parse(
      await invokeFeedback({ operation: "submit", input })
    );
  },
  async image(target) {
    return C.FeedbackImageSchema.parse(
      await invokeFeedback({ operation: "image", target })
    );
  },
  async captureWindow() {
    return C.FeedbackImageSchema.parse(
      await invokeFeedback({ operation: "captureWindow" })
    );
  }
};
