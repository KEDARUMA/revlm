import { ref } from "vue";

// Simple auth/session flags for the demo UI.
// デモUI用の簡易認証フラグ。
export const isLoggedIn = ref(false);
export const currentAuthId = ref<string | null>(null);
