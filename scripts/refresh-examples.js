const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const packagesDir = path.join(rootDir, "packages");

const run = (command, options = {}) => {
  execSync(command, { stdio: "inherit", ...options });
};

const listWorkspacePackages = () => {
  if (!fs.existsSync(packagesDir)) return [];
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name));
};

const removeRootNodeModules = () => {
  // Remove root node_modules to avoid public-hoist-pattern mismatches.
  // public-hoist-pattern 不一致を避けるため root の node_modules を削除する。
  const target = path.join(rootDir, "node_modules");
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
};

const removeNodeModules = (pkgDir) => {
  const target = path.join(pkgDir, "node_modules");
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
};

const main = () => {
  removeRootNodeModules();
  run(
    "pnpm update @kedaruma/revlm-server @kedaruma/revlm-client @kedaruma/revlm-shared --latest",
    { cwd: rootDir }
  );

  const workspacePackages = listWorkspacePackages();
  if (workspacePackages.length === 0) {
    console.log("[refresh-packages] no packages/* found");
    return;
  }

  for (const pkgDir of workspacePackages) {
    console.log(`[refresh-packages] reinstalling ${pkgDir}`);
    removeNodeModules(pkgDir);
    run("pnpm install", { cwd: pkgDir });
  }
};

main();
