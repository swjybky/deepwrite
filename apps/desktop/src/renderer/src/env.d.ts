/// <reference types="vite/client" />

import type { DeepWriteApi } from "@deepwrite/contracts";

declare global {
  interface Window {
    deepwrite?: DeepWriteApi;
  }
}

export {};
