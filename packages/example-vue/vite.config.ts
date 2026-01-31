import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Vite config for the example-vue demo.
// example-vue デモ用の Vite 設定。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
  },
});
