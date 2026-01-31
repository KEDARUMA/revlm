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
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { getRevlmClient } from "../lib/revlmClient";
import { currentAuthId, isLoggedIn } from "../state/session";

// Login page handles demo authentication.
// デモログインを行うページ。
const router = useRouter();
const authId = ref("demo");
const password = ref("demo-pass");
const error = ref<string | null>(null);
const loading = ref(false);

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
</script>
