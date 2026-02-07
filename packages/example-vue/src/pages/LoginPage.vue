<template>
  <div class="page">
    <div class="card">
      <h1>Revlm Vue Demo Login</h1>
      <p>Sign in with the demo account to open the demonstration page.</p>
    </div>

    <div class="card">
      <form @submit.prevent="handleLogin">
        <label for="authId">Auth ID</label>
        <input id="authId" v-model="authId" placeholder="demo" />

        <label for="password">Password</label>
        <input id="password" v-model="password" type="password" placeholder="demo-pass" />

        <button type="submit" :disabled="loading">
          {{ loading ? "Logging in..." : "Login" }}
        </button>
        <button type="button" @click="openRegister" style="margin-left: 8px;">
          Create account
        </button>
      </form>

      <div v-if="error" class="error">{{ error }}</div>
    </div>

    <div class="card">
      <h2>Environment</h2>
      <div class="notice">
        This demo reads settings from <code>.env</code> in packages/example-vue.
        Make sure VITE_* values are set.
      </div>
    </div>

    <div class="card">
      <h2>Demo operations (provisional)</h2>
      <div class="log-box">
        <div v-for="(line, idx) in demoLogs" :key="idx">{{ line }}</div>
      </div>
    </div>

    <div v-if="showRegister" class="modal-backdrop">
      <div class="modal">
        <h2>Create account</h2>
        <p>Register a new user via provisional login.</p>
        <form @submit.prevent="handleRegister">
          <label for="registerAuthId">Auth ID</label>
          <input id="registerAuthId" v-model="registerAuthId" placeholder="new-user" />

          <label for="registerPassword">Password</label>
          <input id="registerPassword" v-model="registerPassword" type="password" placeholder="new-pass" />

          <div class="modal-actions">
            <button type="submit" :disabled="registerLoading">
              {{ registerLoading ? "Registering..." : "Register" }}
            </button>
            <button type="button" @click="closeRegister">
              Close
            </button>
          </div>
        </form>
        <div v-if="registerError" class="error">{{ registerError }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getEnv } from "../lib/env";
import { getRevlmClient } from "../lib/revlmClient";
import { currentAuthId, demoLogs, isLoggedIn, preLoginProvisioned } from "../state/session";

// Login page handles demo authentication.
// デモログインを行うページ。
const router = useRouter();
const authId = ref("demo");
const password = ref("demo-pass");
const error = ref<string | null>(null);
const loading = ref(false);
const showRegister = ref(false);
const registerAuthId = ref("");
const registerPassword = ref("");
const registerError = ref<string | null>(null);
const registerLoading = ref(false);
const env = getEnv();
const PROV_DEMO_AUTH_ID = "prov-demo-user";
const PROV_DEMO_PASSWORD = "prov-demo-pass";

// Append a line to the shared demo log.
// 共有デモログに1行追加する。
function addLog(line: string) {
  demoLogs.value.push(line);
}

// Perform login with the demo credentials.
// デモ用の認証情報でログインする。
async function handleLogin() {
  error.value = null;
  loading.value = true;
  try {
    const revlm = getRevlmClient();
    const res = await revlm.login(authId.value, password.value);
    if (!res.ok) {
      throw new Error(res.error || res.reason || "login failed");
    }
    currentAuthId.value = authId.value;
    isLoggedIn.value = true;
    await router.push("/demo");
  } catch (err: any) {
    error.value = err?.message || String(err);
  } finally {
    loading.value = false;
  }
}

// Open the provisional registration modal and reset inputs.
// 仮登録モーダルを開き、入力状態をリセットする。
function openRegister() {
  registerError.value = null;
  registerAuthId.value = "";
  registerPassword.value = "";
  showRegister.value = true;
}

// Close the provisional registration modal.
// 仮登録モーダルを閉じる。
function closeRegister() {
  showRegister.value = false;
}

// Register a new user via provisional login.
// 仮ログインで新規ユーザを登録する。
async function handleRegister() {
  registerError.value = null;
  registerLoading.value = true;
  try {
    const revlm = getRevlmClient();
    const provisional = await revlm.provisionalLogin(env.provisionalAuthId);
    if (!provisional.ok) {
      throw new Error(provisional.error || provisional.reason || "provisional login failed");
    }
    const res = await revlm.registerUser(
      { authId: registerAuthId.value, userType: "user", roles: ["user"] },
      registerPassword.value
    );
    if (!res.ok) {
      throw new Error(res.error || res.reason || "register failed");
    }
    authId.value = registerAuthId.value;
    password.value = registerPassword.value;
    showRegister.value = false;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    registerError.value = msg;
  } finally {
    registerLoading.value = false;
  }
}

// Run the provisional registration once on login page mount.
// ログイン画面の初期表示時に仮登録を1回だけ実行する。
onMounted(() => {
  if (preLoginProvisioned.value) return;
  const runProvision = async () => {
    demoLogs.value = [];
    addLog("[pre-login] provisionalLogin (auto)");
    const revlm = getRevlmClient();
    try {
      const provisional = await revlm.provisionalLogin(env.provisionalAuthId);
      if (!provisional.ok) {
        throw new Error(provisional.error || provisional.reason || "provisional login failed");
      }
      addLog("[pre-login] registerUser (auto)");
      const registerRes = await revlm.registerUser(
        { authId: PROV_DEMO_AUTH_ID, userType: "user", roles: ["user"], name: "Prov Demo User" },
        PROV_DEMO_PASSWORD
      );
      if (!registerRes.ok) {
        const reason = registerRes.error || registerRes.reason || "register failed";
        if (reason.includes("authId already exists")) {
          addLog("[pre-login] registerUser skipped (already exists)");
        } else {
          throw new Error(reason);
        }
      } else {
        addLog("[pre-login] registerUser ok");
      }
      preLoginProvisioned.value = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`[error] ${msg}`);
      preLoginProvisioned.value = false;
    } finally {
      // Clear provisional token to avoid polluting the main session.
      // 仮ログイントークンを破棄して本セッションの汚染を防ぐ。
      revlm.clearToken();
    }
  };
  runProvision();
});
</script>
