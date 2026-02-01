/*
Test overview:
- Smoke: `@kedaruma/revlm-client/revlm-compat` exports are resolvable.
- Integration: create an instance via the compat entrypoint and exercise all `/revlm-gate` methods
  that are supported by the client wrapper (excluding `watch`/`drop` by request).
  We intentionally keep this test "Realm-like": `revlm.db(...).collection<T>(...)` style access.
  Config is loaded from `src/__tests__/test.env`.
  `x-revlm-session-id` is required by the server in the current multi-session design.
  A minimal CookieStore is used to emulate browser-like cookie persistence for Node fetch.
-
テスト概要:
- Smoke: `@kedaruma/revlm-client/revlm-compat` のエクスポート解決を確認。
- Integration: 互換エントリポイント経由でインスタンスを生成し、クライアントがラップしている
  `/revlm-gate` の全メソッド（依頼により `watch`/`drop` は除外）を一通り実行します。
  `revlm.db(...).collection<T>(...)` という Realm 風の書き味で動作することを狙います。
  設定は `src/__tests__/test.env` から読み込みます。
  現在のマルチセッション仕様では `x-revlm-session-id` が必須です。
  Node fetch でCookieを保持するため、最小の CookieStore を使います。
*/

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { jest } from "@jest/globals";
import { ObjectId } from "bson";
import type * as RevlmCompat from "../revlm-compat";
import { Revlm } from "../revlm-compat";
import {
  cleanupTestEnvironment,
  SetupTestEnvironmentResult,
  setupTestEnvironment,
} from "@kedaruma/revlm-server/__tests__/setupTestMongo";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "test.env") });

let testEnv: SetupTestEnvironmentResult;

// Integration tests may start a local server and do a few round-trips.
// 統合テストはローカルサーバ起動＋複数往復があるため少し長めに。
jest.setTimeout(120000);

const TEST_DB = "testdb";
const COLL_NAME = "compat_testcoll";
const SESSION_ID = "compat-session";

function createFetchWithCookies(baseFetch: typeof fetch) {
  // Extremely small cookie jar:
  // - store only `Set-Cookie` first segment (`name=value`)
  // - attach it to subsequent requests as `Cookie: name=value`
  //
  // 最小限のCookie jar:
  // - `Set-Cookie` の先頭（`name=value`）だけ保存
  // - 次のリクエストに `Cookie: name=value` として付与
  const cookieJar = { value: "" };
  return async (input: any, init: RequestInit = {}) => {
    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const baseHeaders = isRequest ? input.headers : undefined;
    const headers = new Headers(init.headers || baseHeaders || {});
    if (cookieJar.value) headers.set("cookie", cookieJar.value);
    const request = isRequest ? new Request(input, { headers }) : new Request(input, { ...init, headers });
    const res = await baseFetch(request);
    const setCookie = (res.headers as any).getSetCookie?.() ?? res.headers.get("set-cookie");
    const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (cookieValue) cookieJar.value = cookieValue.split(";")[0];
    return res;
  };
}

describe("revlm-compat entrypoint", () => {
  it("exports Revlm class", () => {
    expect(typeof Revlm).toBe("function");
    expect(typeof Revlm.prototype).toBe("object");
  });

  it("can access MongoDB via /revlm-gate using the compat-style API (no watch/drop)", async () => {
    // 1) Start test environment (MongoDB + revlm-server).
    // 1) テスト環境を起動（MongoDB + revlm-server）。
    testEnv = await setupTestEnvironment({
      serverConfig: {
        // If MONGO_URI is empty in test.env, setupTestEnvironment will start MongoMemoryServer.
        // test.env の MONGO_URI が空なら setupTestEnvironment が MongoMemoryServer を起動します。
        mongoUri: process.env.MONGO_URI as string,
        usersDbName: process.env.USERS_DB_NAME as string,
        usersCollectionName: process.env.USERS_COLLECTION_NAME as string,
        jwtSecret: process.env.JWT_SECRET as string,
        provisionalLoginEnabled: true,
        provisionalAuthId: process.env.PROVISIONAL_AUTH_ID as string,
        provisionalAuthSecretMaster: process.env.PROVISIONAL_AUTH_SECRET_MASTER as string,
        provisionalAuthDomain: process.env.PROVISIONAL_AUTH_DOMAIN as string,
        refreshSecretSigningKey: process.env.REFRESH_SECRET_SIGNING_KEY as string,
        port: 0,
      },
    });

    // 2) Create a Revlm client from the compat entrypoint.
    // 2) compat エントリポイントから Revlm クライアントを生成。
    const v = new Revlm(testEnv.serverUrl, {
      provisionalEnabled: true,
      provisionalAuthSecretMaster: process.env.PROVISIONAL_AUTH_SECRET_MASTER as string,
      provisionalAuthDomain: process.env.PROVISIONAL_AUTH_DOMAIN as string,
      fetchImpl: createFetchWithCookies(fetch),
      sessionId: SESSION_ID,
      autoSetToken: true,
      autoRefreshOn401: false,
      logLevel: "info",
    });

    // 3) Provisionally login so we can register a real user.
    // 3) 仮ログイン（registerUser を呼べるトークンを取得）。
    const provRes = await v.provisionalLogin(process.env.PROVISIONAL_AUTH_ID as string);
    if (!provRes.ok) throw new Error(`provisionalLogin failed: ${JSON.stringify(provRes)}`);

    // 4) Register + login as a real user.
    // 4) 本ユーザの作成→ログイン。
    const authId = `compat-${Date.now()}`;
    const password = `pw-${Math.random().toString(36).slice(2, 10)}`;
    const regRes = await v.registerUser({ authId, userType: "user", roles: [] }, password);
    if (!regRes.ok) throw new Error(`registerUser failed: ${JSON.stringify(regRes)}`);

    const loginRes = await v.login(authId, password);
    if (!loginRes.ok) throw new Error(`login failed: ${JSON.stringify(loginRes)}`);

    // 5) "Realm-like" collection access with official namespace typing.
    // 5) Realm 風のコレクションアクセス（公式の名前空間型で注釈）。
    type Doc = { _id: ObjectId; name: string; value: number; note?: string };
    const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<Doc> = v.db(TEST_DB).collection<Doc>(COLL_NAME);

    // insertOne
    // 単一挿入
    const r1 = await coll.insertOne({ name: "a", value: 1 });
    expect(r1).toBeDefined();
    expect((r1 as any).insertedId).toBeDefined();

    // insertMany
    // 複数挿入
    const im = await coll.insertMany([{ name: "b", value: 2 }, { name: "c", value: 3 }]);
    expect(im).toBeDefined();
    const insertedIds = (im as any).insertedIds;
    if (Array.isArray(insertedIds)) {
      expect(insertedIds.length).toBe(2);
    } else if (insertedIds && typeof insertedIds === "object") {
      expect(Object.keys(insertedIds).length).toBe(2);
    } else {
      throw new Error(`insertMany returned unexpected insertedIds: ${String(insertedIds)}`);
    }

    // find
    // 検索（複数）
    const all = await coll.find({});
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(3);

    // findOne
    // 検索（単一）
    const fo = await coll.findOne({ name: "a" });
    expect(fo).not.toBeNull();
    expect((fo as any).name).toBe("a");

    // findOneAndUpdate
    // 検索して更新
    await coll.findOneAndUpdate({ name: "a" }, { $set: { value: 10, note: "updated" } });
    const afterUpdate = await coll.findOne({ name: "a" });
    expect((afterUpdate as any).value).toBe(10);

    // findOneAndReplace
    // 検索して置換
    await coll.findOneAndReplace({ name: "a" }, { name: "a", value: 100, note: "replaced" } as any);
    const afterReplace = await coll.findOne({ name: "a" });
    expect(afterReplace).not.toBeNull();
    expect((afterReplace as any).value).toBe(100);

    // findOneAndDelete
    // 検索して削除
    await coll.findOneAndDelete({ name: "b" });
    const afterDelete = await coll.findOne({ name: "b" });
    expect(afterDelete === null || afterDelete === undefined).toBeTruthy();

    // aggregate
    // 集計
    const agg = await coll.aggregate([
      { $match: {} },
      { $group: { _id: null, total: { $sum: "$value" } } },
    ]);
    expect(Array.isArray(agg)).toBe(true);

    // count
    // 件数
    const cnt = await coll.count({});
    expect(typeof cnt).toBe("number");
    expect(cnt).toBeGreaterThanOrEqual(2);

    // updateOne / updateMany
    // 単一/複数 更新
    await coll.insertMany([{ name: "u1", value: 1 }, { name: "u2", value: 1 }]);
    const u1 = await coll.updateOne({ name: "u1" }, { $set: { value: 42 } });
    expect(u1).toBeDefined();
    const um = await coll.updateMany({ value: 1 }, { $set: { value: 2 } });
    expect(um).toBeDefined();

    // deleteOne
    // 単一削除
    const delOne = await coll.deleteOne({ name: "u1" });
    expect(delOne).toBeDefined();

    // deleteMany
    // 複数削除（コレクションを空にする）
    const delMany = await coll.deleteMany({});
    expect(delMany).toBeDefined();

    // 6) Cleanup (stop server + in-memory Mongo).
    // 6) 後片付け（サーバ停止 + in-memory Mongo停止）。
    await cleanupTestEnvironment(testEnv);
  });
});
