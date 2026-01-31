import { createRouter, createWebHistory } from "vue-router";
import LoginPage from "./pages/LoginPage.vue";
import DemoPage from "./pages/DemoPage.vue";
import { isLoggedIn } from "./state/session";

// Application routes (login -> demo).
// 画面遷移（ログイン -> デモ）。
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/login" },
    { path: "/login", name: "login", component: LoginPage },
    { path: "/demo", name: "demo", component: DemoPage },
  ],
});

// Block demo page unless the user is logged in.
// ログイン済みでなければデモページへ遷移させない。
router.beforeEach((to) => {
  if (to.name === "demo" && !isLoggedIn.value) {
    return { name: "login" };
  }
  return true;
});

export default router;
