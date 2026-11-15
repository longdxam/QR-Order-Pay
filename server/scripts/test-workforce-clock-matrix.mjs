import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const vitest = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const clocks = [
  ['VN 00:05, previous-day fixtures', '2026-11-14T17:05:00Z'],
  ['VN noon', '2026-11-15T05:00:00Z'],
  ['VN 23:59, week/month boundary', '2026-05-31T16:59:00Z'],
];
for (const [label, now] of clocks) {
  console.log(`Workforce clock: ${label} (${now})`);
  const result = spawnSync(
    process.execPath,
    [vitest, 'run', 'src/__tests__/integration/workforce.test.ts', '--maxWorkers=1'],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, TZ: 'Asia/Ho_Chi_Minh', WORKFORCE_TEST_NOW: now },
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
