import { Buffer } from "buffer";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import "./styles.css";

// Provide Buffer for browser runtime (revlm-client uses it internally).
// ブラウザ実行時に Buffer を補完（revlm-client が内部で使用）。
globalThis.Buffer = Buffer;

// Bootstrap the Vue demo app.
// Vueデモアプリを起動する。
const app = createApp(App);
app.use(router);
app.mount("#app");
