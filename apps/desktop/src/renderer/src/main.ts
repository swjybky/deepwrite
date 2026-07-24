import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";

const platform = /Mac|Macintosh/.test(navigator.userAgent) ? "darwin" : "other";
document.documentElement.dataset.platform = platform;

createApp(App).use(createPinia()).mount("#app");
