import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import "./styles.css";

// Bootstrap the Vue demo app.
// Vueデモアプリを起動する。
const app = createApp(App);
app.use(router);
app.mount("#app");
