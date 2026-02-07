import { Revlm } from "@kedaruma/revlm-client/revlm-compat";
import type * as RevlmCompat from "@kedaruma/revlm-client/revlm-compat";
import dotenv from "dotenv";
import net from "net";
import { URL } from "url";
import { printMoviesReport } from "./moviesReport.js";

// Entrypoint for demo CLI usage.
// CLIデモ用の実行エントリポイント。
//
// This script assumes the server is already running.
// It does NOT start the server by itself.
//
// このスクリプトはサーバ起動済みを前提とする。
// サーバ起動は行わない。
async function run() {
  // Load environment variables from .env in this package.
  // このパッケージ配下の .env から環境変数を読み込む。
  dotenv.config();

  // Resolve runtime configuration (env override with defaults).
  // 実行時設定を環境変数から解決（無ければデフォルト）。
  const baseUrl = process.env.REVLM_BASE_URL;
  const usersDbName = process.env.USERS_DB_NAME;
  const sessionId = process.env.REVLM_SESSION_ID;
  const provisionalAuthSecretMaster = process.env.PROVISIONAL_AUTH_SECRET_MASTER;
  const provisionalAuthDomain = process.env.PROVISIONAL_AUTH_DOMAIN;

  // Error if any required env vars are missing.
  // 環境変数が見つからない場合はエラー。
  if (!baseUrl || !usersDbName || !sessionId || !provisionalAuthSecretMaster || !provisionalAuthDomain) {
    throw new Error(
      [
        "Missing required .env values for demo.",
        "Please create packages/example-cli/.env with:",
        "  REVLM_BASE_URL=...",
        "  USERS_DB_NAME=...",
        "  REVLM_SESSION_ID=...",
        "  PROVISIONAL_AUTH_SECRET_MASTER=...",
        "  PROVISIONAL_AUTH_DOMAIN=...",
      ].join("\n")
    );
  }

  // Demo credentials (pre-created by example-server).
  // example-server が起動時に作るデモアカウント。
  const demoAuthId = "demo";
  const demoPassword = "demo-pass";

  // Pretty logging helper for step-by-step demo output.
  // ステップを分かりやすく表示するためのログヘルパー。
  const step = (title: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n=== ${title} ===`);
  };
  const log = (...args: any[]) => console.log("[example-cli]", ...args);

  // 0) Connectivity check (fail fast).
  // 0) 接続確認（未起動なら即失敗）。
  step("0) server connectivity check (tcp)");
  try {
    const url = new URL(baseUrl);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const host = url.hostname;
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(port, host);
      const onError = (err: Error) => {
        socket.destroy();
        reject(err);
      };
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
    });
    log("server reachable", { baseUrl });
  } catch (e: any) {
    throw new Error(
      [
        "Server is not reachable.",
        `baseUrl=${baseUrl}`,
        "",
        "Please start the server first (demo mode):",
        "  1) cd packages/example-server",
        "  2) pnpm demo",
        "",
        `Details: ${e?.message || e}`,
      ].join("\n")
    );
  }

  // 1) Create Revlm client with a minimal cookie store.
  // 1) Revlmクライアントを作成（最小CookieStore付き）。
  step("1) create client");
  const cookieJar = new Map<string, string>();
  const cookieStore: RevlmCompat.CookieStore = {
    getCookieHeader: () => {
      if (!cookieJar.size) return undefined;
      return Array.from(cookieJar.entries())
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
    },
    setCookie: (_url, setCookieHeader) => {
      if (!setCookieHeader) return;
      const [cookiePair] = setCookieHeader.split(";");
      if (!cookiePair) return;
      const sep = cookiePair.indexOf("=");
      if (sep === -1) return;
      const name = cookiePair.slice(0, sep).trim();
      const value = cookiePair.slice(sep + 1).trim();
      if (!name) return;
      cookieJar.set(name, value);
    },
  };

  const revlm = new Revlm(baseUrl, {
    provisionalEnabled: true,
    provisionalAuthSecretMaster,
    provisionalAuthDomain,
    sessionId,
    autoSetToken: true,
    autoRefreshOn401: true,
    cookieStore,
    logLevel: "info",
  });
  log("client ready", { baseUrl, usersDbName, sessionId });

  // 2) Login with demo user (no register).
  // 2) デモユーザでログイン（registerはしない）。
  step("2) login (demo user)");
  log("login start", { authId: demoAuthId });
  const loginRes = await revlm.login(demoAuthId, demoPassword);
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.error || loginRes.reason}`);
  log("login ok", { authId: demoAuthId, userType: loginRes.user?.userType });

  // 3) Open a collection via RevlmCompat namespace.
  // 3) RevlmCompat でコレクションを取得。
  step("3) open collection");
  type DemoDoc = { _id: unknown; name: string; value: number; note?: string };
  const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<DemoDoc> =
    revlm.db(usersDbName).collection<DemoDoc>("demo_items");
  log("collection ready", { db: usersDbName, collection: "demo_items" });

  // 4) deleteMany (clean slate).
  // 4) deleteMany（初期化）。
  step("4) deleteMany");
  log("deleteMany start", { filter: {} });
  const delAll = await coll.deleteMany({});
  log("deleteMany ok", delAll);

  // 5) insertOne.
  // 5) insertOne。
  step("5) insertOne");
  const r1 = await coll.insertOne({ name: "a", value: 1 });
  log("insertOne ok", r1);

  // 6) insertMany.
  // 6) insertMany。
  step("6) insertMany");
  const rMany = await coll.insertMany([{ name: "b", value: 2 }, { name: "c", value: 3 }]);
  log("insertMany ok", rMany);

  // 7) find.
  // 7) find。
  step("7) find");
  const all = await coll.find({});
  log("find ok", { count: all.length, sample: all[0] });

  // 8) findOne.
  // 8) findOne。
  step("8) findOne");
  const fo = await coll.findOne({ name: "a" });
  log("findOne ok", fo);

  // 9) findOneAndUpdate.
  // 9) findOneAndUpdate。
  step("9) findOneAndUpdate");
  const f1u = await coll.findOneAndUpdate({ name: "a" }, { $set: { value: 10, note: "updated" } });
  log("findOneAndUpdate ok", f1u);

  // 10) findOneAndReplace.
  // 10) findOneAndReplace。
  step("10) findOneAndReplace");
  const f1r = await coll.findOneAndReplace({ name: "a" }, { name: "a", value: 100, note: "replaced" } as any);
  log("findOneAndReplace ok", f1r);

  // 11) findOneAndDelete.
  // 11) findOneAndDelete。
  step("11) findOneAndDelete");
  const f1d = await coll.findOneAndDelete({ name: "b" });
  log("findOneAndDelete ok", f1d);

  // 12) aggregate.
  // 12) aggregate。
  step("12) aggregate");
  const agg = await coll.aggregate([{ $match: {} }, { $group: { _id: null, total: { $sum: "$value" } } }]);
  log("aggregate ok", agg);

  // 13) count.
  // 13) count。
  step("13) count");
  const cnt = await coll.count({});
  log("count ok", { count: cnt });

  // 14) updateOne / updateMany.
  // 14) updateOne / updateMany。
  step("14) updateOne & updateMany");
  await coll.insertMany([{ name: "u1", value: 1 }, { name: "u2", value: 1 }]);
  const u1 = await coll.updateOne({ name: "u1" }, { $set: { value: 42 } });
  log("updateOne ok", u1);
  const um = await coll.updateMany({ value: 1 }, { $set: { value: 2 } });
  log("updateMany ok", um);

  // 15) deleteOne.
  // 15) deleteOne。
  step("15) deleteOne");
  const d1 = await coll.deleteOne({ name: "u1" });
  log("deleteOne ok", d1);

  // 16) deleteMany.
  // 16) deleteMany。
  step("16) deleteMany");
  const dMany = await coll.deleteMany({});
  log("deleteMany ok", dMany);

  // 17) provisional user create/delete.
  // 17) 仮ユーザの作成/削除。
  const tempAuthId = "prov-demo-user";
  const tempPassword = "prov-demo-pass";
  step("17) provisionalLogin (temp user)");
　　　　　　　　　　　　　　　　　  const provisional = await revlm.provisionalLogin(process.env.PROVISIONAL_AUTH_ID || "example-prov");
  if (!provisional.ok) throw new Error(`provisional login failed: ${provisional.error || provisional.reason}`);
  log("provisionalLogin ok", { authId: tempAuthId });
  step("18) registerUser (temp user)");
  const tempUser = { authId: tempAuthId, userType: "user", roles: ["example"], name: "Example Temp" };
  const registerTemp = await revlm.registerUser(tempUser, tempPassword);
  if (!registerTemp.ok) throw new Error(`registerUser failed: ${registerTemp.error || registerTemp.reason}`);
  log("registerUser ok", { authId: tempAuthId });
  step("19) login (temp user)");
  const tempLogin = await revlm.login(tempAuthId, tempPassword);
  if (!tempLogin.ok) throw new Error(`login failed: ${tempLogin.error || tempLogin.reason}`);
  log("login ok", { authId: tempAuthId });
  step("20) deleteUser (temp user)");
  const deleteTemp = await revlm.deleteUser({ authId: tempAuthId });
  if (!deleteTemp.ok) throw new Error(`deleteUser failed: ${deleteTemp.error || deleteTemp.reason}`);
  log("deleteUser ok", { authId: tempAuthId });

  // 21) movies_combined report (read-only).
  // 21) movies_combined レポート（読み取りのみ）。
  step("21) movies_combined report");
  await printMoviesReport(revlm, usersDbName);

  // Done.
  // 完了。
  step("done");
  log("demo flow completed");
}

run().catch((error) => {
  console.error("Example CLI demo flow failed", error);
  process.exit(1);
});
