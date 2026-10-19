import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const appDir = process.env.E2E_APP_DIR ? resolve(process.env.E2E_APP_DIR) : root;
const server = createServer();
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const dbPort = server.address().port;
await new Promise((resolve) => server.close(resolve));

const databaseDir = await mkdtemp(join(tmpdir(), 'booking-e2e-pg-'));
const password = randomUUID();
const database = new EmbeddedPostgres({
  databaseDir, port: dbPort, user: 'postgres', password, persistent: false,
  postgresFlags: ['-h', '127.0.0.1', '-F'],
  onLog() {},
  onError(message) { console.error('[e2e-postgres]', message); },
});
const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${dbPort}/booking_e2e`;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  POSTGRES_URL_NON_POOLING: databaseUrl,
  JWT_SECRET: `e2e-only-${randomUUID()}-${randomUUID()}`,
  NODE_ENV: 'development',
  BOOKING_WINDOW_DAYS: '30',
  RATE_LIMIT_AUTH_MAX: '500',
  RATE_LIMIT_BOOKING_MAX: '500',
  RATE_LIMIT_PUBLIC_MAX: '2000',
  NEXT_TELEMETRY_DISABLED: '1',
};
let nextProcess;
let started = false;
let closing = false;

async function close() {
  if (closing) return;
  closing = true;
  if (nextProcess && nextProcess.exitCode === null) {
    const closed = new Promise((resolve) => nextProcess.once('exit', resolve));
    nextProcess.kill('SIGTERM');
    const timer = setTimeout(() => nextProcess.kill('SIGKILL'), 5000);
    await closed;
    clearTimeout(timer);
  }
  if (started) await database.stop();
  await rm(databaseDir, { recursive: true, force: true });
}

process.once('SIGTERM', () => { close().finally(() => process.exit(0)); });
process.once('SIGINT', () => { close().finally(() => process.exit(0)); });

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: appDir, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`E2E setup command exited ${code}`)));
  });
}

try {
  await database.initialise();
  await database.start();
  started = true;
  await database.createDatabase('booking_e2e');
  await runNode([join(root, 'node_modules/prisma/build/index.js'), 'generate']);
  await runNode([join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy']);
  // The full seed only ever receives our freshly created, disposable local DB.
  await runNode([join(appDir, 'prisma/seed.js')]);
  const { Client } = require('pg');
  const { feedSlots } = require(join(appDir, 'prisma/seed/slot-feed.js'));
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try { await feedSlots({ client }); } finally { await client.end(); }
  console.log('[e2e] Isolated PostgreSQL fixture ready.');
  nextProcess = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', process.env.E2E_PORT || '3217'], { cwd: appDir, env, stdio: 'inherit' });
  nextProcess.once('error', async (error) => { console.error(error); await close(); process.exitCode = 1; });
  nextProcess.once('exit', async (code) => { await close(); process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error);
  await close();
  process.exitCode = 1;
}
