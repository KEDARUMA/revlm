const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const run = (pkg) => {
  const cmd = `npm view ${pkg} version`;
  const version = execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] })
    .toString()
    .trim();
  console.log(`${pkg}@${version}`);
};

run("@kedaruma/revlm-server");
run("@kedaruma/revlm-client");
run("@kedaruma/revlm-shared");

const rootDir = path.resolve(__dirname, "..");
const packagesDir = path.join(rootDir, "packages");
const targetPkgs = [
  "@kedaruma/revlm-server",
  "@kedaruma/revlm-client",
  "@kedaruma/revlm-shared",
];

const listWorkspacePackages = () => {
  if (!fs.existsSync(packagesDir)) return [];
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, dir: path.join(packagesDir, entry.name) }));
};

const readInstalledVersion = (pkgDir, pkgName) => {
  const pkgJsonPath = path.join(pkgDir, "node_modules", pkgName, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return null;
  try {
    const raw = fs.readFileSync(pkgJsonPath, "utf8");
    const data = JSON.parse(raw);
    return data && data.version ? String(data.version) : null;
  } catch {
    return null;
  }
};

const workspacePackages = listWorkspacePackages();
if (workspacePackages.length === 0) {
  console.log("[showver] no packages/* found");
} else {
  for (const pkg of workspacePackages) {
    console.log(`\n[packages/${pkg.name}]`);
    for (const dep of targetPkgs) {
      const version = readInstalledVersion(pkg.dir, dep);
      console.log(`  ${dep}: ${version ?? "(not installed)"}`);
    }
  }
}
