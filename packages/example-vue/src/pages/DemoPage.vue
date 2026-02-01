<template>
  <div class="page">
    <div class="card">
      <h1>Revlm Vue Demo</h1>
      <p>Gate operations first, then search the movies dataset.</p>
    </div>

    <div class="card">
      <h2>Search</h2>
      <form @submit.prevent="handleSearch">
        <label for="search">Search movies_combined</label>
        <input id="search" v-model="searchQuery" placeholder="Type keywords and press Enter" />
        <button type="submit" :disabled="searching">{{ searching ? "Searching..." : "Run search" }}</button>
      </form>
      <div v-if="searchError" class="error">{{ searchError }}</div>
    </div>

    <div class="card">
      <h2>Find / Aggregate</h2>
      <p>Run raw queries against <code>movies_combined</code>. Results are shown as JSON.</p>
      <form @submit.prevent="handleFind">
        <label for="findQuery">Find filter (JSON)</label>
        <input id="findQuery" v-model="findQuery" />
        <button type="submit" :disabled="findLoading">{{ findLoading ? "Running..." : "Run find" }}</button>
      </form>
      <div v-if="findError" class="error">{{ findError }}</div>
      <pre v-if="findOutput" class="code-box">{{ findOutput }}</pre>

      <form @submit.prevent="handleAggregate">
        <label for="aggregateQuery">Aggregate pipeline (JSON array)</label>
        <input id="aggregateQuery" v-model="aggregateQuery" />
        <button type="submit" :disabled="aggregateLoading">{{ aggregateLoading ? "Running..." : "Run aggregate" }}</button>
      </form>
      <div v-if="aggregateError" class="error">{{ aggregateError }}</div>
      <pre v-if="aggregateOutput" class="code-box">{{ aggregateOutput }}</pre>
    </div>

    <div class="card" v-if="mode === 'demo'">
      <h2>Demo operations (gate)</h2>
      <div class="log-box">
        <div v-for="(line, idx) in demoLogs" :key="idx">{{ line }}</div>
      </div>
    </div>

    <div class="card" v-else>
      <h2>Search results</h2>
      <div v-if="searchResults.length === 0">No results.</div>
      <div v-for="(row, idx) in searchResults" :key="idx" class="result-item result-row">
        <div class="thumb-cell">
          <img v-if="row.cover_photo" :src="row.cover_photo" alt="cover" class="thumb" />
        </div>
        <div class="result-body">
          <strong>{{ row.title || "" }} ({{ row.year || "?" }})</strong>
          <div>{{ row.description }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type * as RevlmCompat from "@kedaruma/revlm-client/revlm-compat";
import { getEnv } from "../lib/env";
import { getRevlmClient } from "../lib/revlmClient";
import { currentAuthId, isLoggedIn } from "../state/session";
import type { MoviesCombined } from "../moviesCombinedTypes";

// Demo page runs gate operations and provides search.
// ゲート操作のデモと検索UIを提供するページ。
const router = useRouter();
const env = getEnv();
const revlm = getRevlmClient();

const demoLogs = ref<string[]>([]);
const searchQuery = ref("");
type SearchRow = Pick<MoviesCombined, "year" | "title" | "description" | "cover_photo">;
const searchResults = ref<SearchRow[]>([]);
const searching = ref(false);
const searchError = ref<string | null>(null);
const mode = ref<"demo" | "search">("demo");
const findQuery = ref('{ "year": 2024 }');
const findOutput = ref<string>("");
const findError = ref<string | null>(null);
const findLoading = ref(false);
const aggregateQuery = ref('[{ "$match": { "year": 2024 } }, { "$limit": 5 }]');
const aggregateOutput = ref<string>("");
const aggregateError = ref<string | null>(null);
const aggregateLoading = ref(false);

function addLog(line: string) {
  demoLogs.value.push(line);
}

function isAuthError(err: unknown): boolean {
  const anyErr = err as any;
  if (anyErr?.response?.status === 401) return true;
  const message = typeof anyErr?.message === "string" ? anyErr.message : String(anyErr);
  return message.includes("401") || message.includes("Unauthorized") || message.includes("Token expired");
}

async function handleAuthFailure(err: unknown) {
  if (!isAuthError(err)) return false;
  isLoggedIn.value = false;
  currentAuthId.value = "";
  await router.push("/login");
  return true;
}

async function runGateDemo() {
  // Guard if the user isn't logged in.
  // ログインしていない場合はガードする。
  if (!isLoggedIn.value) {
    await router.push("/login");
    return;
  }

  try {
    addLog("[1] open collection demo_items");
    type DemoDoc = { _id: unknown; name: string; value: number; note?: string };
    const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<DemoDoc> =
      revlm.db(env.usersDbName).collection<DemoDoc>("demo_items");

    addLog("[2] deleteMany {}");
    await coll.deleteMany({});

    addLog("[3] insertOne { name: 'a', value: 1 }");
    await coll.insertOne({ name: "a", value: 1 });

    addLog("[4] insertMany { b, c }");
    await coll.insertMany([
      { name: "b", value: 2 },
      { name: "c", value: 3 },
    ]);

    addLog("[5] find {} (count)");
    const all = await coll.find({});
    addLog(`    result count = ${all.length}`);

    addLog("[6] findOne { name: 'a' }");
    const one = await coll.findOne({ name: "a" });
    addLog(`    findOne => ${JSON.stringify(one)}`);

    addLog("[7] findOneAndUpdate { name: 'a' }");
    await coll.findOneAndUpdate({ name: "a" }, { $set: { value: 10, note: "updated" } });

    addLog("[8] findOneAndReplace { name: 'a' }");
    await coll.findOneAndReplace({ name: "a" }, { name: "a", value: 100, note: "replaced" } as any);

    addLog("[9] findOneAndDelete { name: 'b' }");
    await coll.findOneAndDelete({ name: "b" });

    addLog("[10] aggregate sum(value)");
    const agg = await coll.aggregate([{ $group: { _id: null, total: { $sum: "$value" } } }]);
    addLog(`    aggregate => ${JSON.stringify(agg)}`);

    addLog("[11] count {} ");
    const count = await coll.count({});
    addLog(`    count => ${count}`);

    addLog("[12] updateOne/updateMany");
    await coll.insertMany([
      { name: "u1", value: 1 },
      { name: "u2", value: 1 },
    ]);
    await coll.updateOne({ name: "u1" }, { $set: { value: 42 } });
    await coll.updateMany({ value: 1 }, { $set: { value: 2 } });

    addLog("[13] deleteOne { name: 'u1' }");
    await coll.deleteOne({ name: "u1" });

    addLog("[14] deleteMany {} (cleanup)");
    await coll.deleteMany({});

    addLog("Demo operations completed.");
  } catch (err: unknown) {
    if (await handleAuthFailure(err)) return;
    const msg = err instanceof Error ? err.message : String(err);
    demoLogs.value.push(`[error] ${msg}`);
  }
}

async function handleSearch() {
  searchError.value = null;
  searching.value = true;
  searchResults.value = [];

  // Clear demo logs when running a search.
  // 検索実行時はデモログをクリアする。
  demoLogs.value = [];
  mode.value = "search";

  try {
    const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesCombined> =
      revlm.db(env.usersDbName).collection<MoviesCombined>("movies_combined");
    const rows = (await coll.aggregate([
      { $match: { $text: { $search: searchQuery.value } } },
      { $limit: 10 },
      { $project: { year: 1, title: 1, description: 1, cover_photo: 1 } },
    ])) as SearchRow[];
    searchResults.value = (rows || []).map((row) => ({
      year: row?.year ?? "",
      title: row?.title ?? "",
      description: row?.description ?? "",
      cover_photo: row?.cover_photo ?? "",
    }));
  } catch (err: unknown) {
    if (await handleAuthFailure(err)) return;
    const msg = err instanceof Error ? err.message : String(err);
    searchError.value = msg;
  } finally {
    searching.value = false;
  }
}

async function handleFind() {
  findError.value = null;
  findOutput.value = "";
  findLoading.value = true;
  try {
    const filter = JSON.parse(findQuery.value || "{}");
    const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesCombined> =
      revlm.db(env.usersDbName).collection<MoviesCombined>("movies_combined");
    const rows = await coll.find(filter, { limit: 100 });
    findOutput.value = JSON.stringify(rows, null, 2);
  } catch (err: unknown) {
    if (await handleAuthFailure(err)) return;
    const msg = err instanceof Error ? err.message : String(err);
    findError.value = msg;
  } finally {
    findLoading.value = false;
  }
}

async function handleAggregate() {
  aggregateError.value = null;
  aggregateOutput.value = "";
  aggregateLoading.value = true;
  try {
    const pipeline = JSON.parse(aggregateQuery.value || "[]");
    if (!Array.isArray(pipeline)) {
      throw new Error("aggregate pipeline must be a JSON array");
    }
    const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesCombined> =
      revlm.db(env.usersDbName).collection<MoviesCombined>("movies_combined");
    const rows = await coll.aggregate(pipeline);
    aggregateOutput.value = JSON.stringify(rows, null, 2);
  } catch (err: unknown) {
    if (await handleAuthFailure(err)) return;
    const msg = err instanceof Error ? err.message : String(err);
    aggregateError.value = msg;
  } finally {
    aggregateLoading.value = false;
  }
}

onMounted(() => {
  runGateDemo().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    demoLogs.value.push(`[error] ${msg}`);
  });
});
</script>
