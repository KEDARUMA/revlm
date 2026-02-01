const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const packagesDir = path.join(rootDir, "packages");

const run = (command, options = {}) => {
  execSync(command, { stdio: "inherit", ...options });
};

const listExamplePackages = () => {
  if (!fs.existsSync(packagesDir)) return [];
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("example-"))
    .map((entry) => path.join(packagesDir, entry.name));
};

const removeNodeModules = (pkgDir) => {
  const target = path.join(pkgDir, "node_modules");
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
};

const main = () => {
  run(
    "pnpm update @kedaruma/revlm-server @kedaruma/revlm-client @kedaruma/revlm-shared --latest",
    { cwd: rootDir }
  );

  const examplePackages = listExamplePackages();
  if (examplePackages.length === 0) {
    console.log("[refresh-examples] no packages/example-* found");
    return;
  }

  for (const pkgDir of examplePackages) {
    console.log(`[refresh-examples] reinstalling ${pkgDir}`);
    removeNodeModules(pkgDir);
    run("pnpm install", { cwd: pkgDir });
  }
};

main();
