#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

const targets = {
  server: path.join(root, 'packages', 'revlm-server', 'package.json'),
  client: path.join(root, 'packages', 'revlm-client', 'package.json'),
  shared: path.join(root, 'packages', 'revlm-shared', 'package.json'),
};

function getTargetArg() {
  const target = process.argv[2];
  if (!target || !targets[target]) {
    console.error('Usage: node scripts/tag-release.js <server|client|shared> [--print]');
    process.exit(1);
  }
  return target;
}

function readPackageJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildTagMeta(target) {
  const packageJson = readPackageJson(targets[target]);
  if (!packageJson.name || !packageJson.version) {
    throw new Error(`Missing name/version in ${targets[target]}`);
  }
  const packageName = String(packageJson.name).replace(/^@[^/]+\//, '');
  const version = String(packageJson.version);
  return {
    tagName: `${packageName}-v${version}`,
    message: `release: ${packageName} v${version}`,
  };
}

function main() {
  const target = getTargetArg();
  const printOnly = process.argv.includes('--print');
  const { tagName, message } = buildTagMeta(target);
  const command = `git tag -a ${JSON.stringify(tagName)} -m ${JSON.stringify(message)}`;

  if (printOnly) {
    console.log(command);
    return;
  }

  execSync(command, { cwd: root, stdio: 'inherit' });
}

main();
