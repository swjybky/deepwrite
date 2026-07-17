import { createDiscreteApi } from "naive-ui";

const { message } = createDiscreteApi(["message"], {
  messageProviderProps: {
    placement: "top",
    duration: 3200,
    max: 3,
    keepAliveOnHover: true
  }
});

export const uiMessage = message;
