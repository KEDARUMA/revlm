import { spawn } from "child_process";
import { createInterface } from "readline";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Revlm } from "@kedaruma/revlm-client/revlm-compat";
import type { CookieStore } from "@kedaruma/revlm-client/revlm-compat";

// Spawned example-server process info.
// 起動した example-server のプロセス情報。
type ServerProcess = {
  child: ReturnType<typeof spawn>;
  port: number;
};

// Pick a random high port to avoid conflicts.
// 競合回避のため高めのポートを選ぶ。
function resolvePort(): number {
  const base = 48000;
  const span = 1000;
  return base + Math.floor(Math.random() * span);
}

// Start example-server with CLI overrides.
// CLI引数で example-server を起動する。
async function startExampleServer(port: number): Promise<ServerProcess> {
  const args = [
    "--filter",
    "@kedaruma/example-server",
    "start-with-opts",
    "--",
    "--port",
    String(port),
    "--jwtExpiresIn",
    "2",
    "--provisionalLoginEnabled",
    "true",
    "--provisionalAuthId",
    "example-prov",
    "--provisionalAuthSecretMaster",
    "example-master",
    "--provisionalAuthDomain",
    "example.domain",
    "--usersDbName",
    "revlm",
    "--usersCollectionName",
    "users",
    "--jwtSecret",
    "example-secret",
    "--refreshSecretSigningKey",
    "example-refresh-secret",
  ];

  const child = spawn("pnpm", args, {
    cwd: process.cwd(),
    env: { ...process.env, EXAMPLE_SERVER_ENV: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("example-server start timeout")), 60000);
    const handleLine = (line: string) => {
      const important =
        line.includes("Revlm server version") ||
        line.includes("MongoDB connected") ||
        line.includes("Revlm API server started on port") ||
        line.includes("error") ||
        line.includes("Error");
      if (important) {
        console.log(`[example-server] ${line}`);
      }
      if (line.includes("Revlm API server started on port")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    const stdout = child.stdout ? createInterface({ input: child.stdout }) : null;
    const stderr = child.stderr ? createInterface({ input: child.stderr }) : null;
    stdout?.on("line", handleLine);
    stderr?.on("line", handleLine);
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("exit", (code) => {
      if (code && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`example-server exited with code ${code}`));
      }
    });
  });

  await ready;
  return { child, port };
}

// Stop the spawned server process.
// 起動したサーバを停止する。
async function stopExampleServer(info: ServerProcess) {
  info.child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    info.child.once("exit", () => resolve());
  });
}

// Minimal in-memory CookieStore (Node environment).
// Node環境向けの簡易CookieStore。
function createCookieStore(): CookieStore {
  const jar = new Map<string, string>();
  return {
    getCookieHeader: () => {
      if (!jar.size) return undefined;
      return Array.from(jar.entries())
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
      jar.set(name, value);
    },
  };
}

describe("example-vue demo flow", () => {
  let server: ServerProcess;

  beforeAll(async () => {
    server = await startExampleServer(resolvePort());
  }, 120000);

  afterAll(async () => {
    await stopExampleServer(server);
  });

  it(
    "runs the same login/refresh/gate flow as CLI test",
    async () => {
      const cookieStore = createCookieStore();
      const revlm = new Revlm(`http://localhost:${server.port}`, {
        provisionalEnabled: true,
        provisionalAuthSecretMaster: "example-master",
        provisionalAuthDomain: "example.domain",
        autoSetToken: true,
        autoRefreshOn401: true,
        sessionId: "example-vue-session",
        cookieStore,
        logLevel: "info",
      });

      const authId = `example-vue-${Date.now()}`;
      const password = "example-pass";

      const provisional = await revlm.provisionalLogin("example-prov");
      expect(provisional.ok).toBe(true);

      const registerRes = await revlm.registerUser(
        { authId, userType: "staff", roles: ["example"], name: "Example Vue" },
        password
      );
      expect(registerRes.ok).toBe(true);

      const loginRes = await revlm.login(authId, password);
      expect(loginRes.ok).toBe(true);

      // Wait for the access token to expire (jwtExpiresIn=2).
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const refreshRes = await revlm.refreshToken();
      expect(refreshRes.ok).toBe(true);

      type DemoDoc = { _id: unknown; name: string; value: number };
      const coll = revlm.db("revlm").collection<DemoDoc>("demo_items_vue");
      await coll.deleteMany({});
      await coll.insertOne({ name: "alpha", value: 1 });
      const found = await coll.findOne({ name: "alpha" });
      expect(found?.name).toBe("alpha");
      const count = await coll.count({});
      expect(count).toBeGreaterThan(0);
    },
    120000
  );
});
