import { installNativeTextContextMenu } from "./composables/nativeTextContextMenu";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { i18n, setAppLanguage } from "./i18n";
import { loadMessageCatalogs } from "./i18n/load-messages";
import StartupFailure from "./i18n/StartupFailure.vue";
import { initializeAppLanguage } from "./i18n/bootstrap";
import { deepwriteApi } from "./api/deepwrite";
import "./styles.css";

const platform = /Mac|Macintosh/.test(navigator.userAgent) ? "darwin" : "other";
document.documentElement.dataset.platform = platform;

const textContextMenu = deepwriteApi()?.textContextMenu;
if (textContextMenu) {
  const dispose = installNativeTextContextMenu(textContextMenu);
  import.meta.hot?.dispose(dispose);
}

async function mountApplication(): Promise<void> {
  setAppLanguage("auto", navigator.language);
  try {
    await Promise.all([
      initializeAppLanguage(
        deepwriteApi()?.generalSettings,
        navigator.language,
        document.documentElement
      ),
      loadMessageCatalogs()
    ]);
    createApp(App).use(createPinia()).use(i18n).mount("#app");
  } catch (error) {
    console.error("Application language initialization failed.", error);
    createApp(StartupFailure).use(i18n).mount("#app");
  }
}

void mountApplication();
