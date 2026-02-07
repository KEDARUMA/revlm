import { ref } from "vue";

// Simple auth/session flags for the demo UI.
// デモUI用の簡易認証フラグ。
export const isLoggedIn = ref(false);
export const currentAuthId = ref<string | null>(null);

// Shared demo logs for pre/post login flows.
// ログイン前後で共有するデモログ。
export const demoLogs = ref<string[]>([]);

// Guard to avoid repeating pre-login provisioning.
// ログイン前の自動プロビジョニングを重複実行しないためのフラグ。
export const preLoginProvisioned = ref(false);
