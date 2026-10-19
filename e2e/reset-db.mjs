// Starts every e2e run from an empty database of its own: the suite used to
// share worker/.wrangler/state with `wrangler dev`, so the bottles of every
// earlier run piled up (hundreds of them) and the app's start-up loader,
// which preloads them all, got slower run after run. The developer's own
// local data stays where it is.
import { rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const STATE = 'worker/.wrangler/e2e-state';
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply calice-db --local --persist-to ${STATE}`, { stdio: 'inherit', env: { ...process.env, CI: '1' } });
