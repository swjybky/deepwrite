interface ImportMetaEnv {
  readonly MAIN_VITE_DEEPWRITE_APP_MODE?: string;
  readonly MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL?: string;
  readonly MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
