const { execSync } = require("node:child_process");

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
