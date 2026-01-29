import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

// Published-npm integration test runner for Revlm.
// Revlm の「公開npm版」結合テストランナー。
//
// Why this exists:
// - Our monorepo can accidentally hide packaging mistakes because `workspace:*` resolves local sources.
// - This test intentionally downloads *published* npm packages and runs an end-to-end flow against them.
// - This is wired to `pnpm test:npm` (separate from fast `pnpm test`).
//
// 目的:
// - monorepo だと `workspace:*` 解決でローカルソースが使われ、パッケージ公開時の不備を見落としがち。
// - このテストは「公開済みnpmパッケージ」を必ずダウンロードし、E2Eフローが成立することを確認する。
// - 高コストなので `pnpm test` ではなく `pnpm test:npm` に分離している。

type CmdResult = { stdout: string; stderr: string; code: number | null };

async function runCmd(cmd: string, args: string[], cwd: string, env?: Record<string, string>): Promise<CmdResult> {
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b) => (stdout += String(b)));
    child.stderr?.on("data", (b) => (stderr += String(b)));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

async function pnpmViewVersion(pkg: string, cwd: string): Promise<string> {
  // `--json` makes parsing stable.
  // `--json` で安定したパースにする。
  const res = await runCmd("pnpm", ["view", pkg, "version", "--json"], cwd);
  if (res.code !== 0) {
    throw new Error(`pnpm view failed for ${pkg}: code=${res.code}\n${res.stderr || res.stdout}`);
  }
  const raw = res.stdout.trim();
  try {
    // pnpm may return a JSON string (e.g. "1.0.45") or a JSON array in some cases.
    // pnpm の出力は JSON文字列（"1.0.45"）または場合により配列になり得る。
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
  } catch (_e) {
    // fallthrough
  }
  // fallback: treat as plain text
  // フォールバック: プレーンテキストとして扱う
  return raw.replace(/^"+|"+$/g, "");
}

async function writeRunner(tempDir: string) {
  // This runner is executed by `node` with `cwd=tempDir`, so imports resolve from tempDir/node_modules.
  // この runner は `cwd=tempDir` で `node` 実行するため、import は tempDir/node_modules を参照する。
  const runner = `
import { MongoMemoryServer } from "mongodb-memory-server";
import { startServer, stopServer } from "@kedaruma/revlm-server";
import { Revlm } from "@kedaruma/revlm-client/revlm-compat";

// Minimal in-memory cookie store for Node fetch.
// Node fetch 用の最小インメモリ CookieStore。
function createCookieStore() {
  const jar = new Map();
  return {
    getCookieHeader() {
      if (!jar.size) return undefined;
      return Array.from(jar.entries()).map(([k, v]) => \`\${k}=\${v}\`).join("; ");
    },
    setCookie(_url, setCookieHeader) {
      const cookiePair = String(setCookieHeader).split(";")[0];
      const sep = cookiePair.indexOf("=");
      if (sep === -1) return;
      const name = cookiePair.slice(0, sep).trim();
      const value = cookiePair.slice(sep + 1).trim();
      if (!name) return;
      jar.set(name, value);
    },
  };
}

const log = (...args) => console.log("[npm-integration]", ...args);

const mongod = await MongoMemoryServer.create({ instance: { dbName: "revlm" } });
const mongoUri = mongod.getUri();

const server = await startServer({
  mongoUri,
  usersDbName: "revlm",
  usersCollectionName: "users",
  jwtSecret: "example-secret",
  // Make expiry short so refresh flow is actually exercised.
  // 期限を短くして refresh フローが確実に通るようにする。
  jwtExpiresIn: 2,
  provisionalLoginEnabled: true,
  provisionalAuthId: "example-prov",
  provisionalAuthSecretMaster: "example-master",
  provisionalAuthDomain: "example.domain",
  refreshSecretSigningKey: "example-refresh-secret",
  port: 0,
});

const addr = server?.address?.();
const port = addr && typeof addr === "object" ? addr.port : 0;
if (!port) throw new Error("failed to resolve server port");
const baseUrl = \`http://localhost:\${port}\`;
log("server started", { baseUrl });

try {
  const revlm = new Revlm(baseUrl, {
    provisionalEnabled: true,
    provisionalAuthSecretMaster: "example-master",
    provisionalAuthDomain: "example.domain",
    sessionId: "example-cli-session",
    cookieStore: createCookieStore(),
    autoSetToken: true,
    autoRefreshOn401: false,
    logLevel: "info",
  });

  // E2E flow:
  // provisionalLogin -> registerUser -> login -> wait -> refreshToken -> insert/find
  //
  // E2Eフロー:
  // provisionalLogin -> registerUser -> login -> wait -> refreshToken -> insert/find
  const prov = await revlm.provisionalLogin("example-prov");
  if (!prov.ok) throw new Error("provisionalLogin failed: " + JSON.stringify(prov));

  const authId = \`npm-\${Date.now()}\`;
  const password = "example-pass";
  const reg = await revlm.registerUser({ authId, userType: "user", roles: [] }, password);
  if (!reg.ok) throw new Error("registerUser failed: " + JSON.stringify(reg));

  const login = await revlm.login(authId, password);
  if (!login.ok) throw new Error("login failed: " + JSON.stringify(login));

  await new Promise((r) => setTimeout(r, 2500));

  const refresh = await revlm.refreshToken();
  if (!refresh.ok) throw new Error("refreshToken failed: " + JSON.stringify(refresh));

  const coll = revlm.db("revlm").collection("example_items");
  await coll.insertOne({ name: "npm-item", value: 1 });
  const found = await coll.find({ name: "npm-item" });
  if (!Array.isArray(found) || found.length < 1) throw new Error("find did not return expected result");

  log("ok", { found: found.length });
} finally {
  await stopServer();
  await mongod.stop();
  log("server stopped");
}
`;

  await fs.writeFile(path.join(tempDir, "runner.mjs"), runner, "utf8");
}

async function main() {
  const cwd = process.cwd();
  const serverPkg = "@kedaruma/revlm-server";
  const clientPkg = "@kedaruma/revlm-client";

  // Resolve latest published versions first (for visibility + sanity).
  // まず最新publishedのバージョンを解決（可視化＋検証用）。
  const serverVer = await pnpmViewVersion(serverPkg, cwd);
  const clientVer = await pnpmViewVersion(clientPkg, cwd);
  // eslint-disable-next-line no-console
  console.log("[npm-integration] latest versions", { serverPkg: serverVer, clientPkg: clientVer });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "revlm-npm-test-"));
  // eslint-disable-next-line no-console
  console.log("[npm-integration] temp dir", tempDir);

  // Create a tiny project so pnpm installs are isolated from this monorepo.
  // monorepo から分離して pnpm install するための最小プロジェクトを作る。
  await fs.writeFile(
    path.join(tempDir, "package.json"),
    JSON.stringify({ name: "revlm-npm-integration", private: true, type: "module" }, null, 2),
    "utf8"
  );

  // Install published packages + runtime deps for the runner.
  // 公開済みパッケージ＋runnerが必要とする依存をインストール。
  const addRes = await runCmd(
    "pnpm",
    [
      "add",
      `${serverPkg}@latest`,
      `${clientPkg}@latest`,
      "mongodb-memory-server@latest",
    ],
    tempDir
  );
  if (addRes.code !== 0) {
    throw new Error(`pnpm add failed: code=${addRes.code}\n${addRes.stderr || addRes.stdout}`);
  }

  await writeRunner(tempDir);

  // Execute in the isolated project so Node resolves from tempDir/node_modules.
  // 分離したプロジェクト内で実行し、Node解決が tempDir/node_modules になるようにする。
  const runRes = await runCmd("node", ["runner.mjs"], tempDir, {
    // Make sure workspace mappings do not accidentally leak in.
    // ワークスペース解決が漏れ込まないようにする。
    NODE_OPTIONS: "",
  });
  // Mirror output for debugging.
  // デバッグのため標準出力/標準エラーをそのまま表示する。
  if (runRes.stdout.trim()) console.log(runRes.stdout.trim());
  if (runRes.stderr.trim()) console.error(runRes.stderr.trim());
  if (runRes.code !== 0) {
    throw new Error(`npm integration runner failed: code=${runRes.code}`);
  }
}

main().catch((err) => {
  console.error("[npm-integration] failed", err);
  process.exit(1);
});

