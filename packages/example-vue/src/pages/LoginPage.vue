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
import { ref } from "vue";
import { useRouter } from "vue-router";
import { getEnv } from "../lib/env";
import { getRevlmClient } from "../lib/revlmClient";
import { currentAuthId, isLoggedIn } from "../state/session";

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
</script>
