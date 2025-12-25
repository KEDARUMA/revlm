#!/usr/bin/env node
/**
 * Start Revlm server backed by MongoMemoryServer for CI/e2e use.
 * Uses fixed defaults so tests can assume base URL http://localhost:3000
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');

async function main() {
  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();

  process.env.MONGO_URI = mongoUri;
  process.env.USERS_DB_NAME = 'revlm-e2e';
  process.env.USERS_COLLECTION_NAME = 'user-info';
  process.env.JWT_SECRET = 'ci-jwt-secret-please-change';
  process.env.PROVISIONAL_LOGIN_ENABLED = 'true';
  process.env.PROVISIONAL_AUTH_ID = 'revlm-ci-prov';
  process.env.PROVISIONAL_AUTH_SECRET_MASTER = 'ci-provisional-secret';
  process.env.PROVISIONAL_AUTH_DOMAIN = 'ci.revlm.dev';
  process.env.REFRESH_WINDOW_SEC = '0';
  process.env.PORT = process.env.PORT || '3000';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';

  // Require compiled server entry
  const serverPath = path.join(__dirname, '..', 'packages', 'revlm-server', 'dist', 'start.js');
  require(serverPath);

  const cleanup = async () => {
    try {
      await mongod.stop();
    } catch (err) {
      console.error('Failed to stop MongoMemoryServer', err);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('Failed to start memory-backed Revlm server', err);
  process.exit(1);
});
