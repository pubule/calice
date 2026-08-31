# Calice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved `mockups/calice.html` prototype into a deployed, real, multi-user wine-cellar app on the user's Cloudflare account.

**Architecture:** A Hono-based Cloudflare Worker (TypeScript) backed by D1 (relational data) and R2 (photos) serves a JSON API; a Cloudflare Pages static site — the existing mockup split into modules and wired to that API — is the frontend. A Cron Trigger scans for drink-window/low-stock bottles daily and sends Web Push notifications.

**Tech Stack:** Hono, TypeScript, Cloudflare Workers/D1/R2/Pages/Cron Triggers, `web-push` (VAPID) under Workers `nodejs_compat`, Web Crypto `SubtleCrypto` for password hashing, vitest + `@cloudflare/vitest-pool-workers` for backend tests, vanilla JS/CSS frontend (no framework).

**Spec:** `docs/superpowers/specs/2026-09-01-calice-wine-cellar-design.md`

## Global Constraints

- The user's Cloudflare account already has one project, "roccamora" — this work creates separate new resources and must not touch or reference it.
- No live external wine API, no live price scraping, no fabricated "web" reviews — only real user/network data (spec: "Catalog content: no fake web data").
- No frontend framework rewrite — extend `mockups/calice.html` in place/in parts, not from scratch (spec: "Approach").
- Every Worker route is built test-first (write the failing test, watch it fail, implement, watch it pass).
- Password hashing uses only the native Web Crypto `SubtleCrypto` API — no external hashing library (spec: "Auth & sharing").
- No realtime sync layer (no Durable Objects) — the API is read-on-load (spec: "Shared-cellar sync").
- No OCR/label text recognition in this plan — out of scope per spec ("Scan & photos").

---

## File Structure

```
worker/
  src/
    index.ts             — Hono app: mounts all routes, exports fetch + scheduled
    cron.ts               — scheduled handler: drink-window/low-stock scan -> web-push
    lib/auth.ts            — hashPassword, verifyPassword, signSession, verifySession
    lib/session.ts         — requireAuth Hono middleware
    routes/auth.ts         — signup, login, logout, me
    routes/cellars.ts      — list/create cellars, invite, accept-invite
    routes/wines.ts        — search catalog, create custom wine
    routes/bottles.ts      — list (with avg rating)/create/update/delete
    routes/wishlist.ts     — list/create/delete
    routes/notes.ts        — create/list (scoped to self + follows + cellar-mates)
    routes/photos.ts       — upload to R2, list for a bottle
    routes/follows.ts      — follow/unfollow, activity feed
    routes/push.ts         — subscribe to web push
  migrations/0001_init.sql
  seed/wines.sql
  test/
    auth.test.ts
    session.test.ts
    cellars.test.ts
    wines.test.ts
    bottles.test.ts
    wishlist.test.ts
    notes.test.ts
    photos.test.ts
    follows.test.ts
    push.test.ts
    cron.test.ts
  wrangler.jsonc
  package.json
  tsconfig.json
  vitest.config.ts

public/
  index.html             — app shell + nav (evolved from mockups/calice.html body)
  css/app.css             — styles, unchanged design tokens from the mockup
  js/api-client.js         — fetch wrapper (get/post/patch/del, credentials:'include')
  js/router.js             — hash router mounting one screen module per route
  js/auth.js               — login/signup/logout calls + route guard
  js/screens/home.js
  js/screens/cellar.js      — list, wishlist toggle, compare-selection flow
  js/screens/add.js
  js/screens/stats.js
  js/screens/profile.js
  js/screens/detail.js      — location picker, photo gallery, notes tab
  manifest.webmanifest
  sw.js

README.md
```

---

### Task 1: Project scaffold

**Files:**
- Create: `worker/package.json`
- Create: `worker/wrangler.jsonc`
- Create: `worker/tsconfig.json`
- Create: `worker/vitest.config.ts`
- Create: `worker/src/index.ts`

**Interfaces:**
- Produces: a running Hono app (`app`) exported as the Worker's `fetch` handler, with a `GET /health` route returning `{ ok: true }`. Every later route task mounts onto this same `app`.

- [ ] **Step 1: Write `worker/package.json`**

```json
{
  "name": "calice-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "db:migrate": "wrangler d1 migrations apply calice-db",
    "db:seed": "wrangler d1 execute calice-db --file=./seed/wines.sql"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "web-push": "^3.6.7"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.6.0",
    "@cloudflare/workers-types": "^4.20250101.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.90.0"
  }
}
```

- [ ] **Step 2: Write `worker/wrangler.jsonc`**

```jsonc
{
  "name": "calice-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    { "binding": "DB", "database_name": "calice-db", "database_id": "REPLACE_AFTER_D1_CREATE" }
  ],
  "r2_buckets": [
    { "binding": "PHOTOS", "bucket_name": "calice-photos" }
  ],
  "triggers": {
    "crons": ["0 8 * * *"]
  },
  "vars": {
    "PAGES_ORIGIN": "https://calice.pages.dev"
  }
}
```

- [ ] **Step 3: Write `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Write `worker/vitest.config.ts`**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
```

- [ ] **Step 5: Write `worker/src/index.ts`**

```ts
import { Hono } from 'hono';

export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  SESSION_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  PAGES_ORIGIN: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true }));

export default {
  fetch: app.fetch,
};

export { app };
```

- [ ] **Step 6: Install dependencies and verify the dev server boots**

Run: `cd worker && npm install && npx wrangler dev --local`
Expected: server starts; in another terminal, `curl http://localhost:8787/health` returns `{"ok":true}`. Stop the dev server after confirming.

- [ ] **Step 7: Commit**

```bash
git add worker/package.json worker/wrangler.jsonc worker/tsconfig.json worker/vitest.config.ts worker/src/index.ts
git commit -m "chore: scaffold Calice worker project"
```

---

### Task 2: D1 schema migration

**Files:**
- Create: `worker/migrations/0001_init.sql`

**Interfaces:**
- Produces: every table referenced by every later route task, exactly as named/typed below — table and column names here are final and used verbatim in all subsequent SQL.

- [ ] **Step 1: Write `worker/migrations/0001_init.sql`**

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cellars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cellar_members (
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (cellar_id, user_id)
);

CREATE TABLE cellar_invites (
  code TEXT PRIMARY KEY,
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE wines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  producer TEXT NOT NULL,
  region TEXT,
  country TEXT NOT NULL,
  type TEXT NOT NULL,
  vintage INTEGER,
  barcode TEXT,
  source TEXT NOT NULL DEFAULT 'custom',
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX idx_wines_barcode ON wines(barcode);
CREATE INDEX idx_wines_name ON wines(name);

CREATE TABLE bottles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  price_paid REAL,
  shelf_location TEXT,
  drink_from TEXT,
  drink_until TEXT,
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bottles_cellar ON bottles(cellar_id);

CREATE TABLE wishlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  target_price REAL,
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasting_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bottle_id INTEGER NOT NULL REFERENCES bottles(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating REAL NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bottle_id INTEGER NOT NULL REFERENCES bottles(id),
  r2_key TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE follows (
  follower_id INTEGER NOT NULL REFERENCES users(id),
  followee_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE activity_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Create the D1 database and wire its id**

Run: `cd worker && npx wrangler d1 create calice-db`
Then paste the returned `database_id` into `wrangler.jsonc`'s `d1_databases[0].database_id`, replacing `REPLACE_AFTER_D1_CREATE`.

- [ ] **Step 3: Apply the migration locally and verify**

Run: `npx wrangler d1 migrations apply calice-db --local`
Then: `npx wrangler d1 execute calice-db --local --command "select name from sqlite_master where type='table' order by name"`
Expected: lists all 11 tables (`activity_feed, bottles, cellar_invites, cellar_members, cellars, follows, photos, push_subscriptions, tasting_notes, users, wines, wishlist_items`).

- [ ] **Step 4: Commit**

```bash
git add worker/migrations/0001_init.sql worker/wrangler.jsonc
git commit -m "feat: add D1 schema migration"
```

---

### Task 3: Seed wine catalog

**Files:**
- Create: `worker/seed/wines.sql`

**Interfaces:**
- Produces: ~30 rows in `wines` with `source='catalog'`, consumed by Task 8's search endpoint and by the frontend Task 20/23 for realistic demo data.

- [ ] **Step 1: Write `worker/seed/wines.sql`**

```sql
INSERT INTO wines (name, producer, region, country, type, vintage, barcode, source) VALUES
('Barolo DOCG', 'Elio Altare', 'Piemonte', 'Italia', 'rosso', 2016, '8001234500019', 'catalog'),
('Chianti Classico Riserva', 'Castello di Ama', 'Toscana', 'Italia', 'rosso', 2018, '8001234500026', 'catalog'),
('Franciacorta Brut', 'Ca'' del Bosco', 'Lombardia', 'Italia', 'bollicine', 2019, '8001234500033', 'catalog'),
('Vermentino di Gallura', 'Capichera', 'Sardegna', 'Italia', 'bianco', 2022, '8001234500040', 'catalog'),
('Amarone della Valpolicella', 'Allegrini', 'Veneto', 'Italia', 'rosso', 2017, '8001234500057', 'catalog'),
('Cerasuolo d''Abruzzo', 'Valentini', 'Abruzzo', 'Italia', 'rosato', 2021, '8001234500064', 'catalog'),
('Lugana Riserva', 'Ca'' dei Frati', 'Lombardia', 'Italia', 'bianco', 2021, '8001234500071', 'catalog'),
('Taurasi DOCG', 'Mastroberardino', 'Campania', 'Italia', 'rosso', 2015, '8001234500088', 'catalog'),
('Rioja Gran Reserva', 'Bodegas Muga', 'Rioja', 'Spagna', 'rosso', 2015, '8412345600011', 'catalog'),
('Champagne Brut Réserve', 'Bollinger', 'Champagne', 'Francia', 'bollicine', NULL, '3400987600012', 'catalog'),
('Sassicaia', 'Tenuta San Guido', 'Toscana', 'Italia', 'rosso', 2019, '8001234500095', 'catalog'),
('Gavi di Gavi', 'La Scolca', 'Piemonte', 'Italia', 'bianco', 2022, '8001234500101', 'catalog'),
('Trento DOC Riserva', 'Ferrari', 'Trentino', 'Italia', 'bollicine', 2018, '8001234500118', 'catalog'),
('Brunello di Montalcino', 'Biondi Santi', 'Toscana', 'Italia', 'rosso', 2017, '8001234500125', 'catalog'),
('Etna Rosso', 'Planeta', 'Sicilia', 'Italia', 'rosso', 2020, '8001234500132', 'catalog'),
('Etna Bianco', 'Planeta', 'Sicilia', 'Italia', 'bianco', 2022, '8001234500149', 'catalog'),
('Soave Classico', 'Pieropan', 'Veneto', 'Italia', 'bianco', 2022, '8001234500156', 'catalog'),
('Primitivo di Manduria', 'Gianfranco Fino', 'Puglia', 'Italia', 'rosso', 2019, '8001234500163', 'catalog'),
('Verdicchio dei Castelli di Jesi', 'Umani Ronchi', 'Marche', 'Italia', 'bianco', 2022, '8001234500170', 'catalog'),
('Bardolino Chiaretto', 'Zeni', 'Veneto', 'Italia', 'rosato', 2022, '8001234500187', 'catalog'),
('Priorat', 'Alvaro Palacios', 'Priorat', 'Spagna', 'rosso', 2018, '8412345600028', 'catalog'),
('Albariño Rías Baixas', 'Pazo Señorans', 'Galizia', 'Spagna', 'bianco', 2022, '8412345600035', 'catalog'),
('Cava Brut Nature', 'Recaredo', 'Penedès', 'Spagna', 'bollicine', NULL, '8412345600042', 'catalog'),
('Sancerre', 'Domaine Vacheron', 'Loira', 'Francia', 'bianco', 2021, '3400987600029', 'catalog'),
('Châteauneuf-du-Pape', 'Château de Beaucastel', 'Rodano', 'Francia', 'rosso', 2018, '3400987600036', 'catalog'),
('Côtes de Provence Rosé', 'Domaines Ott', 'Provenza', 'Francia', 'rosato', 2022, '3400987600043', 'catalog'),
('Pouilly-Fuissé', 'Château Fuissé', 'Borgogna', 'Francia', 'bianco', 2020, '3400987600050', 'catalog'),
('Barbaresco', 'Gaja', 'Piemonte', 'Italia', 'rosso', 2018, '8001234500194', 'catalog'),
('Vino Nobile di Montepulciano', 'Poliziano', 'Toscana', 'Italia', 'rosso', 2019, '8001234500200', 'catalog'),
('Ribera del Duero Reserva', 'Vega Sicilia', 'Ribera del Duero', 'Spagna', 'rosso', 2016, '8412345600059', 'catalog');
```

- [ ] **Step 2: Apply and verify**

Run: `npx wrangler d1 execute calice-db --local --file=./seed/wines.sql`
Then: `npx wrangler d1 execute calice-db --local --command "select count(*) as n from wines"`
Expected: `n` = 30.

- [ ] **Step 3: Commit**

```bash
git add worker/seed/wines.sql
git commit -m "feat: seed wine catalog"
```

---

### Task 4: Auth crypto library

**Files:**
- Create: `worker/src/lib/auth.ts`
- Test: `worker/test/auth.test.ts`

**Interfaces:**
- Produces: `hashPassword(password: string): Promise<string>`, `verifyPassword(password: string, stored: string): Promise<boolean>`, `signSession(userId: number, secret: string): Promise<string>`, `verifySession(token: string, secret: string): Promise<number | null>` — these exact names/signatures are imported by Task 5 (`session.ts`) and Task 6 (`routes/auth.ts`).

- [ ] **Step 1: Write the failing test `worker/test/auth.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signSession, verifySession } from '../src/lib/auth';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('correct-horse', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
});

describe('session tokens', () => {
  const secret = 'test-secret';

  it('round-trips a valid token', async () => {
    const token = await signSession(42, secret);
    expect(await verifySession(token, secret)).toBe(42);
  });

  it('rejects a tampered token', async () => {
    const token = await signSession(42, secret);
    const tampered = token.slice(0, -2) + 'xx';
    expect(await verifySession(tampered, secret)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession(42, secret);
    expect(await verifySession(token, 'other-secret')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run test/auth.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/auth'`.

- [ ] **Step 3: Write `worker/src/lib/auth.ts`**

```ts
const PBKDF2_ITERATIONS = 100_000;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return `${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [iterStr, saltHex, hashHex] = stored.split(':');
  const iterations = Number(iterStr);
  const salt = fromHex(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return toHex(derived) === hashHex;
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return toHex(sig);
}

export async function signSession(userId: number, secret: string): Promise<string> {
  const payload = `${userId}.${Date.now() + 1000 * 60 * 60 * 24 * 30}`; // 30-day expiry
  const sig = await hmac(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySession(token: string, secret: string): Promise<number | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userIdStr, expStr, sig] = parts;
  const payload = `${userIdStr}.${expStr}`;
  const expected = await hmac(payload, secret);
  if (expected !== sig) return null;
  if (Date.now() > Number(expStr)) return null;
  const userId = Number(userIdStr);
  return Number.isInteger(userId) ? userId : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/auth.ts worker/test/auth.test.ts
git commit -m "feat: password hashing and session tokens"
```

---

### Task 5: Session middleware

**Files:**
- Create: `worker/src/lib/session.ts`
- Test: `worker/test/session.test.ts`

**Interfaces:**
- Consumes: `verifySession` from `../src/lib/auth`.
- Produces: `requireAuth` Hono middleware — on success calls `c.set('userId', number)` and `next()`; on failure returns 401 JSON `{ error: 'unauthorized' }`. Every protected route task (6–14) uses this exact middleware and reads `c.get('userId')`.

- [ ] **Step 1: Write the failing test `worker/test/session.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requireAuth } from '../src/lib/session';
import { signSession } from '../src/lib/auth';

function buildApp() {
  const app = new Hono<{ Bindings: { SESSION_SECRET: string } }>();
  app.use('/protected', requireAuth);
  app.get('/protected', (c) => c.json({ userId: c.get('userId' as never) }));
  return app;
}

describe('requireAuth', () => {
  const env = { SESSION_SECRET: 'test-secret' } as any;

  it('rejects a request with no cookie', async () => {
    const res = await buildApp().request('/protected', {}, env);
    expect(res.status).toBe(401);
  });

  it('accepts a request with a valid session cookie', async () => {
    const token = await signSession(7, env.SESSION_SECRET);
    const res = await buildApp().request('/protected', { headers: { cookie: `session=${token}` } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/session.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/session'`.

- [ ] **Step 3: Write `worker/src/lib/session.ts`**

```ts
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { verifySession } from './auth';
import type { Env } from '../index';

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: { userId: number } }>(
  async (c, next) => {
    const token = getCookie(c, 'session');
    const userId = token ? await verifySession(token, c.env.SESSION_SECRET) : null;
    if (userId === null) return c.json({ error: 'unauthorized' }, 401);
    c.set('userId', userId);
    await next();
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/session.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/session.ts worker/test/session.test.ts
git commit -m "feat: auth session middleware"
```

---

### Task 6: Auth routes

**Files:**
- Create: `worker/src/routes/auth.ts`
- Modify: `worker/src/index.ts` (mount `authRoutes`)
- Test: `worker/test/auth-routes.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `signSession` from `../lib/auth`; `requireAuth` from `../lib/session`; `Env` from `../index`.
- Produces: `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`. Signup also creates a `cellars` row named `"Casa"` owned by the new user and a matching `cellar_members` row — this is the cellar every later bottles/wishlist test seeds against.

- [ ] **Step 1: Write the failing test `worker/test/auth-routes.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
});

describe('POST /api/auth/signup', () => {
  it('creates a user, a default cellar, and sets a session cookie', async () => {
    const res = await app.request(
      '/api/auth/signup',
      { method: 'POST', body: JSON.stringify({ email: 'a@b.com', password: 'secret123', name: 'Fabio' }), headers: { 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^session=/);
    const cellars = await env.DB.prepare('select count(*) as n from cellars').first<{ n: number }>();
    expect(cellars!.n).toBe(1);
  });

  it('rejects a duplicate email with 409', async () => {
    const body = JSON.stringify({ email: 'dup@b.com', password: 'secret123', name: 'Fabio' });
    await app.request('/api/auth/signup', { method: 'POST', body, headers: { 'content-type': 'application/json' } }, env);
    const res = await app.request('/api/auth/signup', { method: 'POST', body, headers: { 'content-type': 'application/json' } }, env);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  it('rejects a wrong password with 401', async () => {
    const body = JSON.stringify({ email: 'a@b.com', password: 'secret123', name: 'Fabio' });
    await app.request('/api/auth/signup', { method: 'POST', body, headers: { 'content-type': 'application/json' } }, env);
    const res = await app.request(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }), headers: { 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a cookie', async () => {
    const res = await app.request('/api/auth/me', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns the user with a valid cookie', async () => {
    const signup = await app.request(
      '/api/auth/signup',
      { method: 'POST', body: JSON.stringify({ email: 'me@b.com', password: 'secret123', name: 'Fabio' }), headers: { 'content-type': 'application/json' } },
      env,
    );
    const cookie = signup.headers.get('set-cookie')!.split(';')[0];
    const res = await app.request('/api/auth/me', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ email: string }>();
    expect(body.email).toBe('me@b.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/auth-routes.test.ts`
Expected: FAIL — 404s, no `authRoutes` mounted yet.

- [ ] **Step 3: Write `worker/src/routes/auth.ts`**

```ts
import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { hashPassword, verifyPassword, signSession } from '../lib/auth';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const authRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();

async function setSessionCookie(c: any, userId: number) {
  const token = await signSession(userId, c.env.SESSION_SECRET);
  setCookie(c, 'session', token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
}

authRoutes.post('/signup', async (c) => {
  const { email, password, name } = await c.req.json<{ email: string; password: string; name: string }>();
  const existing = await c.env.DB.prepare('select id from users where email = ?').bind(email).first();
  if (existing) return c.json({ error: 'email already registered' }, 409);

  const passwordHash = await hashPassword(password);
  const userResult = await c.env.DB
    .prepare('insert into users (email, password_hash, name) values (?, ?, ?) returning id')
    .bind(email, passwordHash, name)
    .first<{ id: number }>();
  const userId = userResult!.id;

  const cellarResult = await c.env.DB
    .prepare('insert into cellars (name, owner_id) values (?, ?) returning id')
    .bind('Casa', userId)
    .first<{ id: number }>();
  await c.env.DB
    .prepare('insert into cellar_members (cellar_id, user_id, role) values (?, ?, ?)')
    .bind(cellarResult!.id, userId, 'owner')
    .run();

  await setSessionCookie(c, userId);
  return c.json({ id: userId, email, name });
});

authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const user = await c.env.DB
    .prepare('select id, password_hash from users where email = ?')
    .bind(email)
    .first<{ id: number; password_hash: string }>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'invalid credentials' }, 401);
  }
  await setSessionCookie(c, user.id);
  return c.json({ id: user.id });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth, async (c) => {
  const user = await c.env.DB
    .prepare('select id, email, name from users where id = ?')
    .bind(c.get('userId'))
    .first();
  return c.json(user);
});
```

- [ ] **Step 4: Mount the routes in `worker/src/index.ts`**

```ts
import { Hono } from 'hono';
import { authRoutes } from './routes/auth';

export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  SESSION_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  PAGES_ORIGIN: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);

export default {
  fetch: app.fetch,
};

export { app };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/auth-routes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/auth.ts worker/src/index.ts worker/test/auth-routes.test.ts
git commit -m "feat: signup/login/logout/me routes"
```

---

### Task 7: Cellar routes (list, create, invite, accept)

**Files:**
- Create: `worker/src/routes/cellars.ts`
- Modify: `worker/src/index.ts` (mount `cellarRoutes`)
- Test: `worker/test/cellars.test.ts`

**Interfaces:**
- Consumes: `requireAuth`.
- Produces: `GET /api/cellars` (cellars the caller is a member of), `POST /api/cellars` (`{name}` → new cellar + owner membership), `POST /api/cellars/:id/invite` (owner-or-member → `{code}`), `POST /api/invites/:code/accept` (adds caller as member). Task 9/10/11 all take a `cellarId` path param and re-check membership the same way this task does — copy the membership-check pattern from Step 3 verbatim.

- [ ] **Step 1: Write the failing test `worker/test/cellars.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  return res.headers.get('set-cookie')!.split(';')[0];
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM cellar_invites; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
});

describe('cellars', () => {
  it('signup creates one cellar, listed for that user', async () => {
    const cookie = await signup('one@b.com');
    const res = await app.request('/api/cellars', { headers: { cookie } }, env);
    const body = await res.json<any[]>();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Casa');
  });

  it('a second user creates their own cellar via POST', async () => {
    const cookie = await signup('two@b.com');
    const res = await app.request(
      '/api/cellars',
      { method: 'POST', body: JSON.stringify({ name: 'Cantina in campagna' }), headers: { cookie, 'content-type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(200);
    const list = await (await app.request('/api/cellars', { headers: { cookie } }, env)).json<any[]>();
    expect(list.map((c: any) => c.name).sort()).toEqual(['Cantina in campagna', 'Casa']);
  });

  it('invite + accept adds the second user as a member', async () => {
    const cookieA = await signup('owner@b.com');
    const cellars = await (await app.request('/api/cellars', { headers: { cookie: cookieA } }, env)).json<any[]>();
    const cellarId = cellars[0].id;

    const inviteRes = await app.request(`/api/cellars/${cellarId}/invite`, { method: 'POST', headers: { cookie: cookieA } }, env);
    const { code } = await inviteRes.json<{ code: string }>();

    const cookieB = await signup('friend@b.com');
    const acceptRes = await app.request(`/api/invites/${code}/accept`, { method: 'POST', headers: { cookie: cookieB } }, env);
    expect(acceptRes.status).toBe(200);

    const listB = await (await app.request('/api/cellars', { headers: { cookie: cookieB } }, env)).json<any[]>();
    expect(listB.some((c: any) => c.id === cellarId)).toBe(true);
  });

  it('accepting a bad code returns 404', async () => {
    const cookie = await signup('lonely@b.com');
    const res = await app.request('/api/invites/does-not-exist/accept', { method: 'POST', headers: { cookie } }, env);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cellars.test.ts`
Expected: FAIL — routes don't exist yet.

- [ ] **Step 3: Write `worker/src/routes/cellars.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const cellarRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
cellarRoutes.use('*', requireAuth);

export async function isCellarMember(db: D1Database, cellarId: number, userId: number): Promise<boolean> {
  const row = await db
    .prepare('select 1 from cellar_members where cellar_id = ? and user_id = ?')
    .bind(cellarId, userId)
    .first();
  return row !== null;
}

cellarRoutes.get('/', async (c) => {
  const rows = await c.env.DB
    .prepare(
      `select cellars.* from cellars
       join cellar_members on cellar_members.cellar_id = cellars.id
       where cellar_members.user_id = ?`,
    )
    .bind(c.get('userId'))
    .all();
  return c.json(rows.results);
});

cellarRoutes.post('/', async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  const userId = c.get('userId');
  const cellar = await c.env.DB
    .prepare('insert into cellars (name, owner_id) values (?, ?) returning *')
    .bind(name, userId)
    .first();
  await c.env.DB
    .prepare('insert into cellar_members (cellar_id, user_id, role) values (?, ?, ?)')
    .bind((cellar as any).id, userId, 'owner')
    .run();
  return c.json(cellar);
});

cellarRoutes.post('/:id/invite', async (c) => {
  const cellarId = Number(c.req.param('id'));
  const userId = c.get('userId');
  if (!(await isCellarMember(c.env.DB, cellarId, userId))) return c.json({ error: 'not a member' }, 403);
  const code = crypto.randomUUID().slice(0, 8);
  await c.env.DB
    .prepare('insert into cellar_invites (code, cellar_id, created_by) values (?, ?, ?)')
    .bind(code, cellarId, userId)
    .run();
  return c.json({ code });
});

export const inviteRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
inviteRoutes.use('*', requireAuth);

inviteRoutes.post('/:code/accept', async (c) => {
  const code = c.req.param('code');
  const invite = await c.env.DB
    .prepare('select cellar_id from cellar_invites where code = ?')
    .bind(code)
    .first<{ cellar_id: number }>();
  if (!invite) return c.json({ error: 'invalid invite code' }, 404);
  await c.env.DB
    .prepare('insert or ignore into cellar_members (cellar_id, user_id, role) values (?, ?, ?)')
    .bind(invite.cellar_id, c.get('userId'), 'member')
    .run();
  return c.json({ cellarId: invite.cellar_id });
});
```

- [ ] **Step 4: Mount both route groups in `worker/src/index.ts`**

Add:

```ts
import { cellarRoutes, inviteRoutes } from './routes/cellars';
// ...
app.route('/api/cellars', cellarRoutes);
app.route('/api/invites', inviteRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/cellars.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/cellars.ts worker/src/index.ts worker/test/cellars.test.ts
git commit -m "feat: cellar list/create/invite/accept routes"
```

---

### Task 8: Wine search and custom wine creation

**Files:**
- Create: `worker/src/routes/wines.ts`
- Modify: `worker/src/index.ts` (mount `wineRoutes`)
- Test: `worker/test/wines.test.ts`

**Interfaces:**
- Produces: `GET /api/wines/search?q=` (name/producer/region LIKE match, limit 20, also supports `?barcode=` exact match for the frontend's barcode-scan flow), `POST /api/wines` (`{name, producer, region, country, type, vintage}` → new row with `source='custom'`).

- [ ] **Step 1: Write the failing test `worker/test/wines.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  return res.headers.get('set-cookie')!.split(';')[0];
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
  await env.DB
    .prepare(`insert into wines (name, producer, region, country, type, vintage, barcode, source)
               values ('Barolo DOCG', 'Elio Altare', 'Piemonte', 'Italia', 'rosso', 2016, '8001234500019', 'catalog')`)
    .run();
});

describe('GET /api/wines/search', () => {
  it('matches by partial name', async () => {
    const cookie = await signup('s1@b.com');
    const res = await app.request('/api/wines/search?q=barolo', { headers: { cookie } }, env);
    const results = await res.json<any[]>();
    expect(results).toHaveLength(1);
    expect(results[0].producer).toBe('Elio Altare');
  });

  it('matches an exact barcode', async () => {
    const cookie = await signup('s2@b.com');
    const res = await app.request('/api/wines/search?barcode=8001234500019', { headers: { cookie } }, env);
    const results = await res.json<any[]>();
    expect(results).toHaveLength(1);
  });
});

describe('POST /api/wines', () => {
  it('creates a custom wine', async () => {
    const cookie = await signup('c1@b.com');
    const res = await app.request(
      '/api/wines',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Vino di famiglia', producer: 'Zio Carlo', region: 'Umbria', country: 'Italia', type: 'rosso', vintage: 2020 }),
        headers: { cookie, 'content-type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ source: string }>();
    expect(body.source).toBe('custom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/wines.test.ts`
Expected: FAIL — 404, route not mounted.

- [ ] **Step 3: Write `worker/src/routes/wines.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const wineRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
wineRoutes.use('*', requireAuth);

wineRoutes.get('/search', async (c) => {
  const barcode = c.req.query('barcode');
  if (barcode) {
    const rows = await c.env.DB.prepare('select * from wines where barcode = ? limit 20').bind(barcode).all();
    return c.json(rows.results);
  }
  const q = `%${c.req.query('q') ?? ''}%`;
  const rows = await c.env.DB
    .prepare('select * from wines where name like ? or producer like ? or region like ? limit 20')
    .bind(q, q, q)
    .all();
  return c.json(rows.results);
});

wineRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name: string; producer: string; region?: string; country: string; type: string; vintage?: number; barcode?: string }>();
  const wine = await c.env.DB
    .prepare(
      `insert into wines (name, producer, region, country, type, vintage, barcode, source, created_by)
       values (?, ?, ?, ?, ?, ?, ?, 'custom', ?) returning *`,
    )
    .bind(body.name, body.producer, body.region ?? null, body.country, body.type, body.vintage ?? null, body.barcode ?? null, c.get('userId'))
    .first();
  return c.json(wine);
});
```

- [ ] **Step 4: Mount in `worker/src/index.ts`**

```ts
import { wineRoutes } from './routes/wines';
// ...
app.route('/api/wines', wineRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/wines.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/wines.ts worker/src/index.ts worker/test/wines.test.ts
git commit -m "feat: wine catalog search and custom wine creation"
```

---

### Task 9: Bottles CRUD

**Files:**
- Create: `worker/src/routes/bottles.ts`
- Modify: `worker/src/index.ts` (mount `bottleRoutes` under both `/api/cellars` for list/create and `/api/bottles` for update/delete)
- Test: `worker/test/bottles.test.ts`

**Interfaces:**
- Consumes: `isCellarMember` from `../lib/cellars` (moved there in Step 3 below so both `cellars.ts` and `bottles.ts` import it without a circular dependency).
- Produces: `GET /api/cellars/:id/bottles` (each row includes a computed `score` field — the average of that bottle's `tasting_notes.rating`, `null` if none — this exact field name `score` is what Task 19's frontend compare flow and Task 21's stats page read), `POST /api/cellars/:id/bottles` (also inserts an `activity_feed` row with `action='added'`), `PATCH /api/bottles/:id`, `DELETE /api/bottles/:id`.

- [ ] **Step 1: Move the membership check into a shared file to avoid a circular import**

Create `worker/src/lib/cellars.ts`:

```ts
export async function isCellarMember(db: D1Database, cellarId: number, userId: number): Promise<boolean> {
  const row = await db
    .prepare('select 1 from cellar_members where cellar_id = ? and user_id = ?')
    .bind(cellarId, userId)
    .first();
  return row !== null;
}
```

In `worker/src/routes/cellars.ts`, delete the local `isCellarMember` function and replace it with:

```ts
import { isCellarMember } from '../lib/cellars';
export { isCellarMember };
```

- [ ] **Step 2: Write the failing test `worker/test/bottles.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  return res.headers.get('set-cookie')!.split(';')[0];
}

async function myCellarId(cookie: string) {
  const cellars = await (await app.request('/api/cellars', { headers: { cookie } }, env)).json<any[]>();
  return cellars[0].id;
}

let wineId: number;

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM activity_feed; DELETE FROM tasting_notes; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
  const wine = await env.DB
    .prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`)
    .first<{ id: number }>();
  wineId = wine!.id;
});

describe('bottles', () => {
  it('creates, lists (with null score), and the list includes activity feed side effect', async () => {
    const cookie = await signup('b1@b.com');
    const cellarId = await myCellarId(cookie);

    const createRes = await app.request(
      `/api/cellars/${cellarId}/bottles`,
      { method: 'POST', body: JSON.stringify({ wineId, quantity: 3, pricePaid: 24, shelfLocation: 'Scaffale A3' }), headers: { cookie, 'content-type': 'application/json' } },
      env,
    );
    expect(createRes.status).toBe(200);

    const listRes = await app.request(`/api/cellars/${cellarId}/bottles`, { headers: { cookie } }, env);
    const bottles = await listRes.json<any[]>();
    expect(bottles).toHaveLength(1);
    expect(bottles[0].score).toBeNull();
    expect(bottles[0].name).toBe('Barolo DOCG');

    const feed = await env.DB.prepare('select count(*) as n from activity_feed where action = ?').bind('added').first<{ n: number }>();
    expect(feed!.n).toBe(1);
  });

  it('computes score as the average tasting_notes rating', async () => {
    const cookie = await signup('b2@b.com');
    const cellarId = await myCellarId(cookie);
    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { cookie, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const userId = (await app.request('/api/auth/me', { headers: { cookie } }, env).then((r) => r.json<{ id: number }>())).id;
    await env.DB.prepare('insert into tasting_notes (bottle_id, user_id, rating, text) values (?, ?, ?, ?)').bind(created.id, userId, 4, 'buono').run();
    await env.DB.prepare('insert into tasting_notes (bottle_id, user_id, rating, text) values (?, ?, ?, ?)').bind(created.id, userId, 5, 'ottimo').run();

    const bottles = await (await app.request(`/api/cellars/${cellarId}/bottles`, { headers: { cookie } }, env)).json<any[]>();
    expect(bottles[0].score).toBe(4.5);
  });

  it('rejects a non-member with 403', async () => {
    const cookieA = await signup('owner2@b.com');
    const cellarId = await myCellarId(cookieA);
    const cookieB = await signup('stranger@b.com');
    const res = await app.request(`/api/cellars/${cellarId}/bottles`, { headers: { cookie: cookieB } }, env);
    expect(res.status).toBe(403);
  });

  it('updates and deletes a bottle', async () => {
    const cookie = await signup('b3@b.com');
    const cellarId = await myCellarId(cookie);
    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/bottles`,
        { method: 'POST', body: JSON.stringify({ wineId, quantity: 1 }), headers: { cookie, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const patchRes = await app.request(
      `/api/bottles/${created.id}`,
      { method: 'PATCH', body: JSON.stringify({ quantity: 5, shelfLocation: 'Frigo' }), headers: { cookie, 'content-type': 'application/json' } },
      env,
    );
    expect(patchRes.status).toBe(200);

    const delRes = await app.request(`/api/bottles/${created.id}`, { method: 'DELETE', headers: { cookie } }, env);
    expect(delRes.status).toBe(200);
    const bottles = await (await app.request(`/api/cellars/${cellarId}/bottles`, { headers: { cookie } }, env)).json<any[]>();
    expect(bottles).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/bottles.test.ts`
Expected: FAIL — route not mounted.

- [ ] **Step 4: Write `worker/src/routes/bottles.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import type { Env } from '../index';

export const cellarBottleRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
cellarBottleRoutes.use('*', requireAuth);

cellarBottleRoutes.get('/:cellarId/bottles', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  if (!(await isCellarMember(c.env.DB, cellarId, c.get('userId')))) return c.json({ error: 'not a member' }, 403);
  const rows = await c.env.DB
    .prepare(
      `select bottles.*, wines.name, wines.producer, wines.region, wines.country, wines.type, wines.vintage,
              (select avg(rating) from tasting_notes where tasting_notes.bottle_id = bottles.id) as score
       from bottles join wines on wines.id = bottles.wine_id
       where bottles.cellar_id = ?
       order by bottles.added_at desc`,
    )
    .bind(cellarId)
    .all();
  return c.json(rows.results);
});

cellarBottleRoutes.post('/:cellarId/bottles', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  const userId = c.get('userId');
  if (!(await isCellarMember(c.env.DB, cellarId, userId))) return c.json({ error: 'not a member' }, 403);
  const body = await c.req.json<{ wineId: number; quantity: number; pricePaid?: number; shelfLocation?: string; drinkFrom?: string; drinkUntil?: string }>();
  const bottle = await c.env.DB
    .prepare(
      `insert into bottles (cellar_id, wine_id, quantity, price_paid, shelf_location, drink_from, drink_until, added_by)
       values (?, ?, ?, ?, ?, ?, ?, ?) returning *`,
    )
    .bind(cellarId, body.wineId, body.quantity, body.pricePaid ?? null, body.shelfLocation ?? null, body.drinkFrom ?? null, body.drinkUntil ?? null, userId)
    .first();
  await c.env.DB
    .prepare('insert into activity_feed (user_id, cellar_id, wine_id, action) values (?, ?, ?, ?)')
    .bind(userId, cellarId, body.wineId, 'added')
    .run();
  return c.json(bottle);
});

export const bottleRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
bottleRoutes.use('*', requireAuth);

async function assertBottleAccess(env: Env, bottleId: number, userId: number): Promise<boolean> {
  const bottle = await env.DB.prepare('select cellar_id from bottles where id = ?').bind(bottleId).first<{ cellar_id: number }>();
  if (!bottle) return false;
  return isCellarMember(env.DB, bottle.cellar_id, userId);
}

bottleRoutes.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await assertBottleAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<Partial<{ quantity: number; pricePaid: number; shelfLocation: string; drinkFrom: string; drinkUntil: string }>>();
  const bottle = await c.env.DB
    .prepare(
      `update bottles set
         quantity = coalesce(?, quantity),
         price_paid = coalesce(?, price_paid),
         shelf_location = coalesce(?, shelf_location),
         drink_from = coalesce(?, drink_from),
         drink_until = coalesce(?, drink_until)
       where id = ? returning *`,
    )
    .bind(body.quantity ?? null, body.pricePaid ?? null, body.shelfLocation ?? null, body.drinkFrom ?? null, body.drinkUntil ?? null, id)
    .first();
  return c.json(bottle);
});

bottleRoutes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await assertBottleAccess(c.env, id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('delete from bottles where id = ?').bind(id).run();
  return c.json({ ok: true });
});
```

- [ ] **Step 5: Mount both groups in `worker/src/index.ts`**

```ts
import { cellarBottleRoutes, bottleRoutes } from './routes/bottles';
// ...
app.route('/api/cellars', cellarBottleRoutes);
app.route('/api/bottles', bottleRoutes);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/bottles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add worker/src/lib/cellars.ts worker/src/routes/cellars.ts worker/src/routes/bottles.ts worker/src/index.ts worker/test/bottles.test.ts
git commit -m "feat: bottles CRUD with computed score and activity feed"
```

---

### Task 10: Wishlist CRUD

**Files:**
- Create: `worker/src/routes/wishlist.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/wishlist.test.ts`

**Interfaces:**
- Consumes: `isCellarMember` from `../lib/cellars`.
- Produces: `GET /api/cellars/:id/wishlist`, `POST /api/cellars/:id/wishlist`, `DELETE /api/wishlist/:id`.

- [ ] **Step 1: Write the failing test `worker/test/wishlist.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  return res.headers.get('set-cookie')!.split(';')[0];
}

let wineId: number;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM wishlist_items; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
  const wine = await env.DB
    .prepare(`insert into wines (name, producer, country, type, source) values ('Sassicaia', 'Tenuta San Guido', 'Italia', 'rosso', 'catalog') returning id`)
    .first<{ id: number }>();
  wineId = wine!.id;
});

describe('wishlist', () => {
  it('adds, lists, and removes an item', async () => {
    const cookie = await signup('w1@b.com');
    const cellars = await (await app.request('/api/cellars', { headers: { cookie } }, env)).json<any[]>();
    const cellarId = cellars[0].id;

    const created = await (
      await app.request(
        `/api/cellars/${cellarId}/wishlist`,
        { method: 'POST', body: JSON.stringify({ wineId, targetPrice: 140 }), headers: { cookie, 'content-type': 'application/json' } },
        env,
      )
    ).json<{ id: number }>();

    const list = await (await app.request(`/api/cellars/${cellarId}/wishlist`, { headers: { cookie } }, env)).json<any[]>();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Sassicaia');

    const delRes = await app.request(`/api/wishlist/${created.id}`, { method: 'DELETE', headers: { cookie } }, env);
    expect(delRes.status).toBe(200);
    const listAfter = await (await app.request(`/api/cellars/${cellarId}/wishlist`, { headers: { cookie } }, env)).json<any[]>();
    expect(listAfter).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/wishlist.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `worker/src/routes/wishlist.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import type { Env } from '../index';

export const cellarWishlistRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
cellarWishlistRoutes.use('*', requireAuth);

cellarWishlistRoutes.get('/:cellarId/wishlist', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  if (!(await isCellarMember(c.env.DB, cellarId, c.get('userId')))) return c.json({ error: 'not a member' }, 403);
  const rows = await c.env.DB
    .prepare(
      `select wishlist_items.*, wines.name, wines.producer, wines.region, wines.country, wines.type
       from wishlist_items join wines on wines.id = wishlist_items.wine_id
       where wishlist_items.cellar_id = ?
       order by wishlist_items.added_at desc`,
    )
    .bind(cellarId)
    .all();
  return c.json(rows.results);
});

cellarWishlistRoutes.post('/:cellarId/wishlist', async (c) => {
  const cellarId = Number(c.req.param('cellarId'));
  const userId = c.get('userId');
  if (!(await isCellarMember(c.env.DB, cellarId, userId))) return c.json({ error: 'not a member' }, 403);
  const body = await c.req.json<{ wineId: number; targetPrice?: number }>();
  const item = await c.env.DB
    .prepare('insert into wishlist_items (cellar_id, wine_id, target_price, added_by) values (?, ?, ?, ?) returning *')
    .bind(cellarId, body.wineId, body.targetPrice ?? null, userId)
    .first();
  return c.json(item);
});

export const wishlistItemRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
wishlistItemRoutes.use('*', requireAuth);

wishlistItemRoutes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const item = await c.env.DB.prepare('select cellar_id from wishlist_items where id = ?').bind(id).first<{ cellar_id: number }>();
  if (!item || !(await isCellarMember(c.env.DB, item.cellar_id, c.get('userId')))) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('delete from wishlist_items where id = ?').bind(id).run();
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Mount in `worker/src/index.ts`**

```ts
import { cellarWishlistRoutes, wishlistItemRoutes } from './routes/wishlist';
// ...
app.route('/api/cellars', cellarWishlistRoutes);
app.route('/api/wishlist', wishlistItemRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/wishlist.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/wishlist.ts worker/src/index.ts worker/test/wishlist.test.ts
git commit -m "feat: wishlist CRUD"
```

---

### Task 11: Tasting notes (scoped visibility)

**Files:**
- Create: `worker/src/routes/notes.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/notes.test.ts`

**Interfaces:**
- Produces: `POST /api/bottles/:id/notes` (`{rating, text}`), `GET /api/bottles/:id/notes` — returns notes where `user_id = caller` OR `user_id` is followed by the caller OR `user_id` is a member of the bottle's cellar. This is the query the spec's "Catalog content: no fake web data" section describes; Task 23's frontend detail sheet renders this list directly as both "your notes" and "community" (partitioned client-side by `note.user_id === me.id`).

- [ ] **Step 1: Write the failing test `worker/test/notes.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const me = await (await app.request('/api/auth/me', { headers: { cookie } }, env)).json<{ id: number }>();
  return { cookie, userId: me.id };
});

let bottleId: number;
let cellarId: number;

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM tasting_notes; DELETE FROM follows; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
  const owner = await signup('owner@notes.com');
  cellarId = (await (await app.request('/api/cellars', { headers: { cookie: owner.cookie } }, env)).json<any[]>())[0].id;
  const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`).first<{ id: number }>();
  const bottle = await app.request(
    `/api/cellars/${cellarId}/bottles`,
    { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 1 }), headers: { cookie: owner.cookie, 'content-type': 'application/json' } },
    env,
  );
  bottleId = (await bottle.json<{ id: number }>()).id;
  await env.DB.exec(`DELETE FROM users WHERE email = 'owner@notes.com'`); // will re-signup fresh below per test to keep ids simple is unnecessary; keep owner
});

describe('tasting notes visibility', () => {
  it('a note is visible to its author, a follower, a cellar-mate, and hidden from a stranger', async () => {
    const author = await signup('author@notes.com');
    await env.DB.prepare('insert into cellar_members (cellar_id, user_id, role) values (?, ?, ?)').bind(cellarId, author.userId, 'member').run();

    await app.request(
      `/api/bottles/${bottleId}/notes`,
      { method: 'POST', body: JSON.stringify({ rating: 4.5, text: 'Ottimo con brasato' }), headers: { cookie: author.cookie, 'content-type': 'application/json' } },
      env,
    );

    // author sees own note
    const authorView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: { cookie: author.cookie } }, env)).json<any[]>();
    expect(authorView).toHaveLength(1);

    // follower sees it
    const follower = await signup('follower@notes.com');
    await env.DB.prepare('insert into follows (follower_id, followee_id) values (?, ?)').bind(follower.userId, author.userId).run();
    const followerView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: { cookie: follower.cookie } }, env)).json<any[]>();
    expect(followerView).toHaveLength(1);

    // cellar-mate sees it (author is already a cellar member)
    const cellarMate = await signup('mate@notes.com');
    await env.DB.prepare('insert into cellar_members (cellar_id, user_id, role) values (?, ?, ?)').bind(cellarId, cellarMate.userId, 'member').run();
    const mateView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: { cookie: cellarMate.cookie } }, env)).json<any[]>();
    expect(mateView).toHaveLength(1);

    // a stranger with no relationship sees nothing
    const stranger = await signup('stranger@notes.com');
    const strangerView = await (await app.request(`/api/bottles/${bottleId}/notes`, { headers: { cookie: stranger.cookie } }, env)).json<any[]>();
    expect(strangerView).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/notes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `worker/src/routes/notes.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const noteRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
noteRoutes.use('*', requireAuth);

noteRoutes.post('/:bottleId/notes', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const userId = c.get('userId');
  const body = await c.req.json<{ rating: number; text: string }>();
  const note = await c.env.DB
    .prepare('insert into tasting_notes (bottle_id, user_id, rating, text) values (?, ?, ?, ?) returning *')
    .bind(bottleId, userId, body.rating, body.text)
    .first();
  return c.json(note);
});

noteRoutes.get('/:bottleId/notes', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const userId = c.get('userId');
  const rows = await c.env.DB
    .prepare(
      `select tasting_notes.*, users.name as author_name
       from tasting_notes
       join users on users.id = tasting_notes.user_id
       join bottles on bottles.id = tasting_notes.bottle_id
       where tasting_notes.bottle_id = ?
         and (
           tasting_notes.user_id = ?
           or tasting_notes.user_id in (select followee_id from follows where follower_id = ?)
           or tasting_notes.user_id in (select user_id from cellar_members where cellar_id = bottles.cellar_id)
         )
       order by tasting_notes.created_at desc`,
    )
    .bind(bottleId, userId, userId)
    .all();
  return c.json(rows.results);
});
```

- [ ] **Step 4: Mount in `worker/src/index.ts`**

```ts
import { noteRoutes } from './routes/notes';
// ...
app.route('/api/bottles', noteRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/notes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/notes.ts worker/src/index.ts worker/test/notes.test.ts
git commit -m "feat: tasting notes with social visibility scope"
```

---

### Task 12: Photo upload (R2)

**Files:**
- Create: `worker/src/routes/photos.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/photos.test.ts`

**Interfaces:**
- Produces: `POST /api/bottles/:id/photos` (multipart `file` field → stores to R2 key `bottles/{bottleId}/{uuid}`, inserts a `photos` row, returns `{id, url}`), `GET /api/bottles/:id/photos` (list of `{id, url}`). `url` is a same-origin `/api/photos/:r2Key` path served by a small GET-by-key route in this same file — no R2 public bucket / signed URL setup needed for this plan.

- [ ] **Step 1: Write the failing test `worker/test/photos.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  return res.headers.get('set-cookie')!.split(';')[0];
}

let bottleId: number;

beforeEach(async () => {
  await env.DB.exec('DELETE FROM photos; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
  const cookie = await signup('p1@b.com');
  const cellarId = (await (await app.request('/api/cellars', { headers: { cookie } }, env)).json<any[]>())[0].id;
  const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`).first<{ id: number }>();
  const bottle = await app.request(
    `/api/cellars/${cellarId}/bottles`,
    { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 1 }), headers: { cookie, 'content-type': 'application/json' } },
    env,
  );
  bottleId = (await bottle.json<{ id: number }>()).id;
});

describe('photos', () => {
  it('uploads a photo and lists it back with a fetchable url', async () => {
    const cookie = await signup('p2@b.com');
    const cellarId = (await (await app.request('/api/cellars', { headers: { cookie } }, env)).json<any[]>())[0].id;
    // give p2 access by making them a member of the same cellar as the bottle
    await env.DB.prepare('insert into cellar_members (cellar_id, user_id, role) values ((select cellar_id from bottles where id = ?), (select id from users where email = ?), ?)').bind(bottleId, 'p2@b.com', 'member').run();

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'label.jpg');

    const uploadRes = await app.request(`/api/bottles/${bottleId}/photos`, { method: 'POST', body: form, headers: { cookie } }, env);
    expect(uploadRes.status).toBe(200);
    const uploaded = await uploadRes.json<{ id: number; url: string }>();

    const listRes = await app.request(`/api/bottles/${bottleId}/photos`, { headers: { cookie } }, env);
    const list = await listRes.json<any[]>();
    expect(list).toHaveLength(1);

    const fileRes = await app.request(uploaded.url, {}, env);
    expect(fileRes.status).toBe(200);
    expect(await fileRes.arrayBuffer()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photos.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `worker/src/routes/photos.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const photoRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
photoRoutes.use('*', requireAuth);

photoRoutes.post('/:bottleId/photos', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const userId = c.get('userId');
  const form = await c.req.formData();
  const file = form.get('file') as File | null;
  if (!file) return c.json({ error: 'file required' }, 400);

  const key = `bottles/${bottleId}/${crypto.randomUUID()}`;
  await c.env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const row = await c.env.DB
    .prepare('insert into photos (bottle_id, r2_key, uploaded_by) values (?, ?, ?) returning *')
    .bind(bottleId, key, userId)
    .first<{ id: number }>();

  return c.json({ id: row!.id, url: `/api/photos/${encodeURIComponent(key)}` });
});

photoRoutes.get('/:bottleId/photos', async (c) => {
  const bottleId = Number(c.req.param('bottleId'));
  const rows = await c.env.DB.prepare('select id, r2_key from photos where bottle_id = ? order by created_at desc').bind(bottleId).all<{ id: number; r2_key: string }>();
  return c.json(rows.results.map((r) => ({ id: r.id, url: `/api/photos/${encodeURIComponent(r.r2_key)}` })));
});

export const photoFileRoutes = new Hono<{ Bindings: Env }>();

photoFileRoutes.get('/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  const object = await c.env.PHOTOS.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream' },
  });
});
```

- [ ] **Step 4: Mount in `worker/src/index.ts`**

```ts
import { photoRoutes, photoFileRoutes } from './routes/photos';
// ...
app.route('/api/bottles', photoRoutes);
app.route('/api/photos', photoFileRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/photos.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/photos.ts worker/src/index.ts worker/test/photos.test.ts
git commit -m "feat: bottle photo upload/list via R2"
```

---

### Task 13: Follows and activity feed

**Files:**
- Create: `worker/src/routes/follows.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/follows.test.ts`

**Interfaces:**
- Produces: `POST /api/follows/:userId`, `DELETE /api/follows/:userId`, `GET /api/me/activity` — feed rows (newest first) from `activity_feed` where the acting user is the caller, someone the caller follows, or a member of a cellar the caller belongs to, joined with `wines.name` and `users.name`. This powers Task 18's Home "Attività amici".

- [ ] **Step 1: Write the failing test `worker/test/follows.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const me = await (await app.request('/api/auth/me', { headers: { cookie } }, env)).json<{ id: number }>();
  return { cookie, userId: me.id };
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM activity_feed; DELETE FROM follows; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
});

describe('follows + activity feed', () => {
  it('follow then unfollow', async () => {
    const a = await signup('fa@b.com');
    const b = await signup('fb@b.com');
    const followRes = await app.request(`/api/follows/${b.userId}`, { method: 'POST', headers: { cookie: a.cookie } }, env);
    expect(followRes.status).toBe(200);
    const unfollowRes = await app.request(`/api/follows/${b.userId}`, { method: 'DELETE', headers: { cookie: a.cookie } }, env);
    expect(unfollowRes.status).toBe(200);
  });

  it('activity feed shows a followed user\'s bottle-add', async () => {
    const a = await signup('feeda@b.com');
    const b = await signup('feedb@b.com');
    await app.request(`/api/follows/${b.userId}`, { method: 'POST', headers: { cookie: a.cookie } }, env);

    const bCellarId = (await (await app.request('/api/cellars', { headers: { cookie: b.cookie } }, env)).json<any[]>())[0].id;
    const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Franciacorta Brut', 'Ca'' del Bosco', 'Italia', 'bollicine', 'catalog') returning id`).first<{ id: number }>();
    await app.request(
      `/api/cellars/${bCellarId}/bottles`,
      { method: 'POST', body: JSON.stringify({ wineId: wine!.id, quantity: 2 }), headers: { cookie: b.cookie, 'content-type': 'application/json' } },
      env,
    );

    const feed = await (await app.request('/api/me/activity', { headers: { cookie: a.cookie } }, env)).json<any[]>();
    expect(feed).toHaveLength(1);
    expect(feed[0].wine_name).toBe('Franciacorta Brut');
    expect(feed[0].actor_name).toBe('feedb@b.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/follows.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `worker/src/routes/follows.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const followRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
followRoutes.use('*', requireAuth);

followRoutes.post('/:userId', async (c) => {
  const followeeId = Number(c.req.param('userId'));
  await c.env.DB
    .prepare('insert or ignore into follows (follower_id, followee_id) values (?, ?)')
    .bind(c.get('userId'), followeeId)
    .run();
  return c.json({ ok: true });
});

followRoutes.delete('/:userId', async (c) => {
  const followeeId = Number(c.req.param('userId'));
  await c.env.DB
    .prepare('delete from follows where follower_id = ? and followee_id = ?')
    .bind(c.get('userId'), followeeId)
    .run();
  return c.json({ ok: true });
});

export const activityRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
activityRoutes.use('*', requireAuth);

activityRoutes.get('/activity', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB
    .prepare(
      `select activity_feed.*, wines.name as wine_name, users.name as actor_name
       from activity_feed
       join wines on wines.id = activity_feed.wine_id
       join users on users.id = activity_feed.user_id
       where activity_feed.user_id = ?
          or activity_feed.user_id in (select followee_id from follows where follower_id = ?)
          or activity_feed.cellar_id in (select cellar_id from cellar_members where user_id = ?)
       order by activity_feed.created_at desc
       limit 50`,
    )
    .bind(userId, userId, userId)
    .all();
  return c.json(rows.results);
});
```

- [ ] **Step 4: Mount in `worker/src/index.ts`**

```ts
import { followRoutes, activityRoutes } from './routes/follows';
// ...
app.route('/api/follows', followRoutes);
app.route('/api/me', activityRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/follows.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/follows.ts worker/src/index.ts worker/test/follows.test.ts
git commit -m "feat: follow/unfollow and activity feed"
```

---

### Task 14: Push subscription endpoint

**Files:**
- Create: `worker/src/routes/push.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/push.test.ts`

**Interfaces:**
- Produces: `POST /api/push/subscribe` (`{endpoint, keys: {p256dh, auth}}` → upsert into `push_subscriptions`). Consumed by Task 15's cron job, which reads this table.

- [ ] **Step 1: Write the failing test `worker/test/push.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  return res.headers.get('set-cookie')!.split(';')[0];
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM push_subscriptions; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;');
});

describe('POST /api/push/subscribe', () => {
  it('stores a subscription and re-subscribing does not duplicate it', async () => {
    const cookie = await signup('push@b.com');
    const body = JSON.stringify({ endpoint: 'https://push.example/abc', keys: { p256dh: 'key1', auth: 'auth1' } });
    await app.request('/api/push/subscribe', { method: 'POST', body, headers: { cookie, 'content-type': 'application/json' } }, env);
    const res2 = await app.request('/api/push/subscribe', { method: 'POST', body, headers: { cookie, 'content-type': 'application/json' } }, env);
    expect(res2.status).toBe(200);
    const count = await env.DB.prepare('select count(*) as n from push_subscriptions').first<{ n: number }>();
    expect(count!.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/push.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `worker/src/routes/push.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import type { Env } from '../index';

export const pushRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
pushRoutes.use('*', requireAuth);

pushRoutes.post('/subscribe', async (c) => {
  const body = await c.req.json<{ endpoint: string; keys: { p256dh: string; auth: string } }>();
  await c.env.DB
    .prepare(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (?, ?, ?, ?)
       on conflict(endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .bind(c.get('userId'), body.endpoint, body.keys.p256dh, body.keys.auth)
    .run();
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Mount in `worker/src/index.ts`**

```ts
import { pushRoutes } from './routes/push';
// ...
app.route('/api/push', pushRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/push.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/push.ts worker/src/index.ts worker/test/push.test.ts
git commit -m "feat: push subscription endpoint"
```

---

### Task 15: Cron notification job

**Files:**
- Create: `worker/src/cron.ts`
- Modify: `worker/src/index.ts` (export `scheduled`)
- Test: `worker/test/cron.test.ts`

**Interfaces:**
- Consumes: `push_subscriptions` (Task 14), `bottles` (Task 9).
- Produces: `runNotificationScan(env: Env, sendFn = webpush.sendNotification): Promise<{ notified: number }>` — exported so the test can call it directly and inject a mock `sendFn`; `worker/src/index.ts`'s `scheduled` export calls it with the real `web-push` sender.

- [ ] **Step 1: Write the failing test `worker/test/cron.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { runNotificationScan } from '../src/cron';

async function signup(email: string) {
  const res = await app.request(
    '/api/auth/signup',
    { method: 'POST', body: JSON.stringify({ email, password: 'secret123', name: email }), headers: { 'content-type': 'application/json' } },
    env,
  );
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const me = await (await app.request('/api/auth/me', { headers: { cookie } }, env)).json<{ id: number }>();
  return { cookie, userId: me.id };
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM push_subscriptions; DELETE FROM bottles; DELETE FROM wines; DELETE FROM cellar_members; DELETE FROM cellars; DELETE FROM users;',
  );
});

describe('runNotificationScan', () => {
  it('sends one push per subscribed user with a bottle in its drink window', async () => {
    const user = await signup('cron@b.com');
    const cellarId = (await (await app.request('/api/cellars', { headers: { cookie: user.cookie } }, env)).json<any[]>())[0].id;
    const wine = await env.DB.prepare(`insert into wines (name, producer, country, type, source) values ('Barolo DOCG', 'Elio Altare', 'Italia', 'rosso', 'catalog') returning id`).first<{ id: number }>();
    await env.DB
      .prepare(`insert into bottles (cellar_id, wine_id, quantity, drink_from, drink_until, added_by) values (?, ?, 1, date('now','-1 day'), date('now','+30 day'), ?)`)
      .bind(cellarId, wine!.id, user.userId)
      .run();
    await app.request(
      '/api/push/subscribe',
      { method: 'POST', body: JSON.stringify({ endpoint: 'https://push.example/xyz', keys: { p256dh: 'k', auth: 'a' } }), headers: { cookie: user.cookie, 'content-type': 'application/json' } },
      env,
    );

    const sendFn = vi.fn().mockResolvedValue(undefined);
    const result = await runNotificationScan(env as any, sendFn);

    expect(result.notified).toBe(1);
    expect(sendFn).toHaveBeenCalledTimes(1);
    const [subscription, payload] = sendFn.mock.calls[0];
    expect(subscription.endpoint).toBe('https://push.example/xyz');
    expect(JSON.parse(payload).body).toContain('Barolo DOCG');
  });

  it('sends nothing when no bottle qualifies', async () => {
    await signup('quiet@b.com');
    const sendFn = vi.fn();
    const result = await runNotificationScan(env as any, sendFn);
    expect(result.notified).toBe(0);
    expect(sendFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cron.test.ts`
Expected: FAIL — `Cannot find module '../src/cron'`.

- [ ] **Step 3: Write `worker/src/cron.ts`**

```ts
import webpush from 'web-push';
import type { Env } from './index';

type SendFn = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, options: any) => Promise<unknown>;

export async function runNotificationScan(env: Env, sendFn: SendFn = webpush.sendNotification as unknown as SendFn) {
  const rows = await env.DB
    .prepare(
      `select distinct push_subscriptions.endpoint, push_subscriptions.p256dh, push_subscriptions.auth,
              bottles.quantity, wines.name as wine_name,
              (bottles.drink_until is not null and date('now') between bottles.drink_from and bottles.drink_until) as in_window,
              (bottles.quantity <= 2) as low_stock
       from bottles
       join wines on wines.id = bottles.wine_id
       join cellar_members on cellar_members.cellar_id = bottles.cellar_id
       join push_subscriptions on push_subscriptions.user_id = cellar_members.user_id
       where (bottles.drink_until is not null and date('now') between bottles.drink_from and bottles.drink_until)
          or bottles.quantity <= 2`,
    )
    .all<{ endpoint: string; p256dh: string; auth: string; wine_name: string; in_window: number; low_stock: number }>();

  let notified = 0;
  for (const row of rows.results) {
    const title = row.in_window ? 'Pronto da bere' : 'Scorte in esaurimento';
    const body = row.in_window
      ? `Il tuo ${row.wine_name} è pronto da bere`
      : `${row.wine_name}: scorte in esaurimento`;
    await sendFn(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify({ title, body }),
      { vapidDetails: { subject: 'mailto:fabio.stocco85@gmail.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } },
    );
    notified++;
  }
  return { notified };
}
```

- [ ] **Step 4: Export `scheduled` from `worker/src/index.ts`**

```ts
import { runNotificationScan } from './cron';
// ...
export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Env) => {
    await runNotificationScan(env);
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/cron.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/cron.ts worker/src/index.ts worker/test/cron.test.ts
git commit -m "feat: cron job for drink-window/low-stock push notifications"
```

---

### Task 16: CORS and end-to-end smoke test

**Files:**
- Modify: `worker/src/index.ts`

**Interfaces:**
- Produces: the Worker accepts credentialed cross-origin requests from `env.PAGES_ORIGIN` — required before Task 17's frontend (a different origin) can call any of the routes above.

- [ ] **Step 1: Add CORS middleware to `worker/src/index.ts`**

```ts
import { cors } from 'hono/cors';
// ... after `const app = new Hono<{ Bindings: Env }>();`
app.use('*', async (c, next) => {
  return cors({ origin: c.env.PAGES_ORIGIN, credentials: true })(c, next);
});
```

- [ ] **Step 2: Run the full test suite**

Run: `cd worker && npx vitest run`
Expected: all tests from Tasks 4–15 still PASS (CORS middleware doesn't affect same-`env` test requests).

- [ ] **Step 3: Manual end-to-end smoke test**

Run: `npx wrangler dev --local`, then in another terminal:

```bash
curl -c cookies.txt -s -X POST http://localhost:8787/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@test.com","password":"secret123","name":"Smoke Test"}'

curl -b cookies.txt -s http://localhost:8787/api/cellars
```

Expected: signup returns a user JSON; `/api/cellars` returns one cellar named `"Casa"`.

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat: enable CORS for the Pages frontend origin"
```

---

### Task 17: Frontend scaffold — API client, router, auth screens

**Files:**
- Create: `public/js/api-client.js`
- Create: `public/js/router.js`
- Create: `public/js/auth.js`
- Modify: `public/index.html` (new login/signup markup + `<script type="module" src="js/main.js">`)
- Create: `public/js/main.js`

**Interfaces:**
- Produces: `api` object (`api.get/post/patch/del(path, body?)`, all `fetch` with `credentials:'include'` against `window.CALICE_API_URL`) and `router` (`registerRoute(hash, mountFn)`, `navigate(hash)`) — every screen task (18–23) imports both by these exact names.

- [ ] **Step 1: Copy the mockup as the starting point**

Run: `cp mockups/calice.html public/index.html`

- [ ] **Step 2: Write `public/js/api-client.js`**

```js
export const API_URL = window.CALICE_API_URL || 'http://localhost:8787';

async function request(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body instanceof FormData ? {} : { 'content-type': 'application/json' },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.hash = '#/login';
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};
```

- [ ] **Step 3: Write `public/js/router.js`**

```js
const routes = new Map();

export function registerRoute(hash, mountFn) {
  routes.set(hash, mountFn);
}

export function navigate(hash) {
  window.location.hash = hash;
}

function renderCurrent() {
  const hash = window.location.hash || '#/home';
  const [base] = hash.split('?');
  const mount = routes.get(base) || routes.get('#/home');
  mount?.(new URLSearchParams(hash.split('?')[1] || ''));
}

export function startRouter() {
  window.addEventListener('hashchange', renderCurrent);
  renderCurrent();
}
```

- [ ] **Step 4: Write `public/js/auth.js`**

```js
import { api } from './api-client.js';

export async function signup(email, password, name) {
  await api.post('/api/auth/signup', { email, password, name });
}

export async function login(email, password) {
  await api.post('/api/auth/login', { email, password });
}

export async function logout() {
  await api.post('/api/auth/logout');
}

export async function me() {
  return api.get('/api/auth/me');
}
```

- [ ] **Step 5: Add login/signup screens to `public/index.html` and wire `public/js/main.js`**

Add this markup inside the existing `.screen` element in `public/index.html`, as two new `.view`s alongside the mockup's existing ones:

```html
<div class="view" id="view-login">
  <div class="topbar"><h2 class="screen-title">Accedi</h2></div>
  <input id="login-email" class="search" placeholder="Email" type="email">
  <input id="login-password" class="search" placeholder="Password" type="password">
  <div class="action" id="login-submit" style="cursor:pointer;">Accedi</div>
  <div class="manual-link" id="go-signup">Non hai un account? Registrati</div>
</div>
<div class="view" id="view-signup">
  <div class="topbar"><h2 class="screen-title">Registrati</h2></div>
  <input id="signup-name" class="search" placeholder="Nome" type="text">
  <input id="signup-email" class="search" placeholder="Email" type="email">
  <input id="signup-password" class="search" placeholder="Password" type="password">
  <div class="action" id="signup-submit" style="cursor:pointer;">Crea account</div>
</div>
```

Write `public/js/main.js`:

```js
import { registerRoute, startRouter, navigate } from './router.js';
import { login, signup, me } from './auth.js';
import { mountHome } from './screens/home.js';
import { mountCellar } from './screens/cellar.js';
import { mountAdd } from './screens/add.js';
import { mountStats } from './screens/stats.js';
import { mountProfile } from './screens/profile.js';

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

registerRoute('#/login', () => showView('view-login'));
registerRoute('#/signup', () => showView('view-signup'));
registerRoute('#/home', async () => { showView('view-home'); await mountHome(); });
registerRoute('#/cellar', async () => { showView('view-cellar'); await mountCellar(); });
registerRoute('#/add', async () => { showView('view-add'); await mountAdd(); });
registerRoute('#/stats', async () => { showView('view-stats'); await mountStats(); });
registerRoute('#/profile', async () => { showView('view-profile'); await mountProfile(); });

document.getElementById('login-submit').addEventListener('click', async () => {
  await login(document.getElementById('login-email').value, document.getElementById('login-password').value);
  navigate('#/home');
});
document.getElementById('go-signup').addEventListener('click', () => navigate('#/signup'));
document.getElementById('signup-submit').addEventListener('click', async () => {
  await signup(
    document.getElementById('signup-email').value,
    document.getElementById('signup-password').value,
    document.getElementById('signup-name').value,
  );
  navigate('#/home');
});

document.querySelectorAll('.navbtn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => navigate('#/' + btn.dataset.view.replace('view-', '')));
});

me().then(() => startRouter()).catch(() => navigate('#/login'));
```

- [ ] **Step 6: Manual verification**

Run: `npx wrangler pages dev public/` (or any static server) with the Worker running on 8787.
Open the served URL. Expected: redirected to `#/login` (no session). Fill signup form, submit → redirected to `#/home`, no console errors. Reload the page → stays on Home (session cookie persists), doesn't bounce back to login.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/js/api-client.js public/js/router.js public/js/auth.js public/js/main.js
git commit -m "feat: frontend scaffold with router and auth screens"
```

---

### Task 18: Home screen wired to real data

**Files:**
- Create: `public/js/screens/home.js`
- Modify: `public/index.html` (remove Home's hardcoded sample markup for stats/alerts/"da bere presto"/regions/activity — replace each with an empty container `id` for `home.js` to fill)

**Interfaces:**
- Consumes: `api` from `../api-client.js`.
- Produces: `mountHome(): Promise<void>`, imported by `main.js` (Task 17).

- [ ] **Step 1: In `public/index.html`, replace the Home view's hardcoded content**

Inside `#view-home`, replace the stat numbers, the two alert banners, the "Da bere presto" scroller contents, the "Regioni principali" region-rows, and the "Attività amici" feed-rows with empty containers carrying stable ids: `#home-stats`, `#home-alerts`, `#home-soon`, `#home-regions`, `#home-feed`. Keep every surrounding wrapper `<div class="card">`/`<div class="section-head">` element exactly as in the mockup — only the data-bearing inner markup is removed.

- [ ] **Step 2: Write `public/js/screens/home.js`**

```js
import { api } from '../api-client.js';

function scoreBadge(score) {
  return score == null ? '' : `<span class="badge-score">${score.toFixed(1)}</span>`;
}

export async function mountHome() {
  const cellars = await api.get('/api/cellars');
  const cellar = cellars[0];
  const bottles = await api.get(`/api/cellars/${cellar.id}/bottles`);
  const activity = await api.get('/api/me/activity');

  const totalBottles = bottles.reduce((n, b) => n + b.quantity, 0);
  const totalValue = bottles.reduce((n, b) => n + (b.price_paid || 0) * b.quantity, 0);
  const today = new Date().toISOString().slice(0, 10);
  const soon = bottles.filter((b) => b.drink_until && b.drink_from <= today && today <= b.drink_until);

  document.getElementById('home-stats').innerHTML = `
    <div class="stat"><div class="num">${totalBottles}</div><div class="lbl">bottiglie</div></div>
    <div class="stat"><div class="num">€${totalValue.toFixed(0)}</div><div class="lbl">valore</div></div>
    <div class="stat"><div class="num">${soon.length}</div><div class="lbl">da bere</div></div>
  `;

  document.getElementById('home-soon').innerHTML = soon
    .slice(0, 5)
    .map(
      (b) => `
      <div class="wine-card">
        <div class="card-photo photo photo-${b.type}">${scoreBadge(b.score)}</div>
        <div class="card-body">
          <div class="name">${b.name}</div>
          <div class="sub">${b.producer} · ${b.vintage ?? ''} · ${b.region ?? b.country}</div>
          <span class="status-tag ready">pronto</span>
        </div>
      </div>`,
    )
    .join('');

  const byRegion = {};
  for (const b of bottles) {
    const key = b.region || b.country;
    byRegion[key] = (byRegion[key] || 0) + b.quantity;
  }
  const maxRegion = Math.max(1, ...Object.values(byRegion));
  document.getElementById('home-regions').innerHTML = Object.entries(byRegion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(
      ([name, n]) => `
      <div class="region-row"><span class="rname">${name}</span>
        <div class="rbar"><i style="width:${(n / maxRegion) * 100}%"></i></div>
        <span class="rn">${n}</span></div>`,
    )
    .join('');

  document.getElementById('home-feed').innerHTML = activity
    .slice(0, 5)
    .map(
      (a) => `
      <div class="feed-row"><div class="rev-avatar">${a.actor_name.slice(0, 2).toUpperCase()}</div>
        <div class="txt"><b>${a.actor_name}</b> ha aggiunto ${a.wine_name}</div>
        <span class="time">${new Date(a.created_at).toLocaleDateString('it-IT')}</span></div>`,
    )
    .join('');

  document.getElementById('home-alerts').innerHTML = ''; // populated below, one banner per condition
  const lowStock = bottles.find((b) => b.quantity <= 2);
  const banners = [];
  if (soon.length) banners.push(`<div class="alert-banner"><div class="txt"><b>Hai vini pronti da bere</b>${soon.length} bottiglie nella finestra di consumo</div></div>`);
  if (lowStock) banners.push(`<div class="alert-banner"><div class="txt"><b>Scorte in esaurimento</b>${lowStock.name}: restano ${lowStock.quantity} bottiglie</div></div>`);
  document.getElementById('home-alerts').innerHTML = banners.join('');
}
```

- [ ] **Step 3: Manual verification**

Add at least one bottle via `curl` against the Worker API (or wait for Task 20's Aggiungi screen), then open `#/home`. Expected: stat numbers reflect the real bottle(s), no hardcoded mockup text remains, no console errors.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/js/screens/home.js
git commit -m "feat: wire Home screen to real API data"
```

---

### Task 19: Cantina screen wired (list, wishlist, compare)

**Files:**
- Create: `public/js/screens/cellar.js`
- Modify: `public/index.html` (empty containers for the cellar list, wishlist list, and filter chip rows)

**Interfaces:**
- Consumes: `api`.
- Produces: `mountCellar(): Promise<void>`. Ports the mockup's inline compare-selection JS (checkbox mode, sticky bar, fill-compare-sheet) verbatim in behavior, now driven by fetched `bottles`/`wishlist` arrays instead of the mockup's hardcoded `data-*` attributes.

- [ ] **Step 1: In `public/index.html`, replace Cantina's hardcoded list/wishlist markup**

Replace the `cellar-list`/`wall-wish` inner rows with empty containers `#cellar-list` and `#wishlist-list`; keep the segmented toggle, chip filter rows, compare button/bar, and compare-overlay markup exactly as in the mockup (their ids/classes are reused as-is).

- [ ] **Step 2: Write `public/js/screens/cellar.js`**

```js
import { api } from '../api-client.js';

let currentCellarId = null;
let currentBottles = [];
let compareMode = false;
let compareSelected = [];

function rowHtml(b) {
  return `
    <div class="cellar-row" data-id="${b.id}" data-photo="photo-${b.type}" data-name="${b.name}" data-sub="${b.producer} · ${b.region ?? b.country}" data-price="€${b.price_paid ?? '—'}" data-score="${b.score != null ? b.score.toFixed(1) : '—'}">
      <div class="rowcheck"><svg class="check-ic" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg></div>
      <div class="cphoto photo photo-${b.type}"></div>
      <div class="cinfo"><div class="name">${b.name}</div><div class="sub">${b.producer} · ${b.region ?? b.country} · ×${b.quantity}${b.shelf_location ? ' · ' + b.shelf_location : ''}</div></div>
      <div class="cprice">${b.price_paid ? '€' + b.price_paid : '—'}<small>a bottiglia</small></div>
      <div class="row-actions">
        <div class="icon-btn edit-btn" data-id="${b.id}" title="Modifica"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></div>
        <div class="icon-btn danger delete-btn" data-id="${b.id}" title="Elimina"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg></div>
      </div>
    </div>`;
}

function wishRowHtml(w) {
  return `
    <div class="wish-row" data-id="${w.id}">
      <div class="wish-photo photo photo-${w.type}"></div>
      <div class="result-body"><div class="name">${w.name}</div><div class="sub">${w.producer} · ${w.region ?? w.country}${w.target_price ? ' · €' + w.target_price : ''}</div></div>
      <div class="wish-add" data-id="${w.id}">Sposta in cantina</div>
    </div>`;
}

async function renderList() {
  const list = document.getElementById('cellar-list');
  list.innerHTML = currentBottles.map(rowHtml).join('');
  list.querySelectorAll('.delete-btn').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.del(`/api/bottles/${btn.dataset.id}`);
      currentBottles = currentBottles.filter((b) => String(b.id) !== btn.dataset.id);
      renderList();
    }),
  );
}

export async function mountCellar() {
  const cellars = await api.get('/api/cellars');
  currentCellarId = cellars[0].id;
  currentBottles = await api.get(`/api/cellars/${currentCellarId}/bottles`);
  await renderList();

  const wishlist = await api.get(`/api/cellars/${currentCellarId}/wishlist`);
  const wishEl = document.getElementById('wishlist-list');
  wishEl.innerHTML = wishlist.map(wishRowHtml).join('');
  wishEl.querySelectorAll('.wish-add').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.del(`/api/wishlist/${btn.dataset.id}`);
      btn.closest('.wish-row').remove();
    }),
  );

  const wallOwned = document.getElementById('wall-owned') || document.getElementById('cellar-list');
  const compareBtn = document.getElementById('compare-open');
  const compareBar = document.getElementById('compare-bar');
  compareBtn?.addEventListener('click', () => {
    compareMode = !compareMode;
    compareSelected = [];
    wallOwned.classList.toggle('selecting', compareMode);
    compareBar.classList.toggle('show', compareMode);
    document.getElementById('compare-count').textContent = '0/2 selezionati';
  });
  wallOwned?.addEventListener('click', (e) => {
    if (!compareMode) return;
    const row = e.target.closest('.cellar-row');
    if (!row) return;
    if (row.classList.contains('selected')) {
      row.classList.remove('selected');
      compareSelected = compareSelected.filter((r) => r !== row);
    } else if (compareSelected.length < 2) {
      row.classList.add('selected');
      compareSelected.push(row);
    }
    document.getElementById('compare-count').textContent = `${compareSelected.length}/2 selezionati`;
    document.getElementById('compare-go').disabled = compareSelected.length !== 2;
  });
  document.getElementById('compare-go')?.addEventListener('click', () => {
    if (compareSelected.length !== 2) return;
    const cols = document.querySelectorAll('#compare-overlay .compare-col');
    compareSelected.forEach((row, i) => {
      cols[i].querySelector('.compare-photo').className = 'compare-photo photo ' + row.dataset.photo;
      cols[i].querySelector('.cname').textContent = row.dataset.name;
      cols[i].querySelector('.csub').textContent = row.dataset.sub;
      const stats = cols[i].querySelectorAll('.stat-line b');
      stats[0].textContent = row.dataset.score;
      stats[1].textContent = row.dataset.price;
    });
    document.getElementById('compare-overlay').classList.add('open');
    compareMode = false;
    wallOwned.classList.remove('selecting');
    compareBar.classList.remove('show');
  });
  document.getElementById('compare-close')?.addEventListener('click', () => document.getElementById('compare-overlay').classList.remove('open'));
}
```

- [ ] **Step 3: Manual verification**

Open `#/cellar`. Expected: bottles list renders from the API (empty if none added yet). Add a bottle via Task 20, revisit `#/cellar` — it appears. Delete it — it disappears and a re-fetch (reload) confirms it's gone. Select 2 bottles in compare mode — the compare sheet shows their real name/price/score.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/js/screens/cellar.js
git commit -m "feat: wire Cantina screen to real API data"
```

---

### Task 20: Aggiungi screen wired (search, barcode, manual add)

**Files:**
- Create: `public/js/screens/add.js`
- Modify: `public/index.html` (empty results container, keep scan tiles/search input ids from the mockup)

**Interfaces:**
- Consumes: `api`.
- Produces: `mountAdd(): Promise<void>`.

- [ ] **Step 1: Write `public/js/screens/add.js`**

```js
import { api } from '../api-client.js';

let currentCellarId = null;

function resultRowHtml(w) {
  return `
    <div class="result-row" data-wine-id="${w.id}">
      <div class="result-photo photo photo-${w.type}"></div>
      <div class="result-body"><div class="name">${w.name}${w.vintage ? ' ' + w.vintage : ''}</div><div class="sub">${w.producer} · ${w.region ?? w.country}</div></div>
      <div class="add-btn" data-wine-id="${w.id}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
    </div>`;
}

async function addWineToCellar(wineId) {
  const quantity = Number(prompt('Quante bottiglie?', '1')) || 1;
  await api.post(`/api/cellars/${currentCellarId}/bottles`, { wineId, quantity });
  alert('Aggiunto alla cantina');
}

function wireResults(container) {
  container.querySelectorAll('.add-btn').forEach((btn) =>
    btn.addEventListener('click', () => addWineToCellar(Number(btn.dataset.wineId))),
  );
}

export async function mountAdd() {
  const cellars = await api.get('/api/cellars');
  currentCellarId = cellars[0].id;

  const searchInput = document.getElementById('add-search-input');
  const results = document.getElementById('add-results');
  searchInput?.addEventListener('input', async () => {
    const q = searchInput.value.trim();
    if (!q) return (results.innerHTML = '');
    const wines = await api.get(`/api/wines/search?q=${encodeURIComponent(q)}`);
    results.innerHTML = wines.map(resultRowHtml).join('');
    wireResults(results);
  });

  const barcodeTile = document.getElementById('scan-barcode-tile');
  barcodeTile?.addEventListener('click', async () => {
    if (!('BarcodeDetector' in window)) {
      alert('Scansione barcode non supportata su questo browser, usa la ricerca testuale.');
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector();
    const barcodes = await detector.detect(video);
    stream.getTracks().forEach((t) => t.stop());
    if (!barcodes.length) return alert('Nessun codice a barre rilevato');
    const wines = await api.get(`/api/wines/search?barcode=${encodeURIComponent(barcodes[0].rawValue)}`);
    results.innerHTML = wines.length ? wines.map(resultRowHtml).join('') : '<p>Nessun vino trovato per questo codice</p>';
    wireResults(results);
  });

  const manualLink = document.getElementById('manual-add-link');
  manualLink?.addEventListener('click', async () => {
    const name = prompt('Nome del vino');
    if (!name) return;
    const producer = prompt('Produttore') || '';
    const country = prompt('Paese', 'Italia') || 'Italia';
    const region = prompt('Regione') || '';
    const type = prompt('Tipo (rosso/bianco/bollicine/rosato)', 'rosso') || 'rosso';
    const wine = await api.post('/api/wines', { name, producer, country, region, type });
    await addWineToCellar(wine.id);
  });
}
```

- [ ] **Step 2: In `public/index.html`, wire ids**

Give the mockup's search `<input>` the id `add-search-input`, the results container the id `add-results`, the barcode scan tile the id `scan-barcode-tile`, and the "Aggiungilo manualmente" link the id `manual-add-link`.

- [ ] **Step 3: Manual verification**

Open `#/add`, type part of "Barolo" → seeded catalog result appears with a working "+" that adds it to the cellar (confirm on `#/cellar`). Click "Aggiungi manualmente", fill the prompts → new custom wine is created and added. On a non-barcode-capable browser, clicking the barcode tile shows the fallback alert instead of crashing.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/js/screens/add.js
git commit -m "feat: wire Aggiungi screen to search/barcode/manual-add APIs"
```

---

### Task 21: Statistiche screen wired

**Files:**
- Create: `public/js/screens/stats.js`
- Modify: `public/index.html` (empty containers for each stat block)

**Interfaces:**
- Consumes: `api`.
- Produces: `mountStats(): Promise<void>`. All aggregation is computed client-side from `/api/cellars/:id/bottles` — no new backend endpoint (per plan Task 21 scope note).

- [ ] **Step 1: In `public/index.html`, replace Statistiche's hardcoded numbers/bars**

Replace the per-type bars, region rows, and value-over-time chart content with empty containers `#stats-summary`, `#stats-type`, `#stats-region`, `#stats-country`.

- [ ] **Step 2: Write `public/js/screens/stats.js`**

```js
import { api } from '../api-client.js';

const TYPE_LABEL = { rosso: 'Rosso', bianco: 'Bianco', bollicine: 'Bollicine', rosato: 'Rosato' };
const TYPE_COLOR = { rosso: '#5b2333', bianco: '#b9a750', bollicine: '#6b7a4f', rosato: '#a24a5a' };

function groupBy(bottles, keyFn) {
  const map = {};
  for (const b of bottles) {
    const key = keyFn(b);
    map[key] = (map[key] || 0) + b.quantity;
  }
  return map;
}

function barRows(map, colorFn) {
  const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `
      <div class="region-row"><span class="rname">${name}</span>
        <div class="rbar"><i style="width:${(n / total) * 100}%${colorFn ? `; background:${colorFn(name)}` : ''}"></i></div>
        <span class="rn">${n}</span></div>`)
    .join('');
}

export async function mountStats() {
  const cellars = await api.get('/api/cellars');
  const bottles = await api.get(`/api/cellars/${cellars[0].id}/bottles`);

  const total = bottles.reduce((n, b) => n + b.quantity, 0);
  const value = bottles.reduce((n, b) => n + (b.price_paid || 0) * b.quantity, 0);
  const vintages = bottles.filter((b) => b.vintage).map((b) => b.vintage);
  const avgVintage = vintages.length ? Math.round(vintages.reduce((a, b) => a + b, 0) / vintages.length) : '—';

  document.getElementById('stats-summary').innerHTML = `
    <div class="stat"><div class="num">${total}</div><div class="lbl">bottiglie</div></div>
    <div class="stat"><div class="num">€${value.toFixed(0)}</div><div class="lbl">valore</div></div>
    <div class="stat"><div class="num">${avgVintage}</div><div class="lbl">annata media</div></div>
  `;

  document.getElementById('stats-type').innerHTML = barRows(groupBy(bottles, (b) => TYPE_LABEL[b.type] || b.type), (name) => TYPE_COLOR[Object.keys(TYPE_LABEL).find((k) => TYPE_LABEL[k] === name)] || '#5b2333');
  document.getElementById('stats-region').innerHTML = barRows(groupBy(bottles, (b) => b.region || b.country));
  document.getElementById('stats-country').innerHTML = barRows(groupBy(bottles, (b) => b.country));
}
```

- [ ] **Step 3: Manual verification**

Open `#/stats` with a few bottles added across types/regions. Expected: per-type/region/country bars reflect real quantities and sum to the total bottle count; no hardcoded mockup numbers remain.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/js/screens/stats.js
git commit -m "feat: wire Statistiche screen to real client-side aggregates"
```

---

### Task 22: Profilo screen wired

**Files:**
- Create: `public/js/screens/profile.js`
- Modify: `public/index.html` (empty containers for cellars list, follows list; keep "Notifiche" toggle id from mockup)

**Interfaces:**
- Consumes: `api`, `logout` from `../auth.js`.
- Produces: `mountProfile(): Promise<void>`.

- [ ] **Step 1: In `public/index.html`, wire ids**

Give "Le mie cantine" row's count span the id `profile-cellar-count`, add a container `#profile-follows` for the follow list, and give the "Notifiche" settings row's toggle element the id `notif-toggle`. Give "Invita" its existing button an id `invite-btn` and a small result area `#invite-result`.

- [ ] **Step 2: Write `public/js/screens/profile.js`**

```js
import { api } from '../api-client.js';
import { logout } from '../auth.js';
import { navigate } from '../router.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function mountProfile() {
  const cellars = await api.get('/api/cellars');
  document.getElementById('profile-cellar-count').textContent = String(cellars.length);

  document.getElementById('invite-btn')?.addEventListener('click', async () => {
    const { code } = await api.post(`/api/cellars/${cellars[0].id}/invite`);
    document.getElementById('invite-result').textContent = `${window.location.origin}/#/invite/${code}`;
  });

  document.getElementById('notif-toggle')?.addEventListener('change', async (e) => {
    if (!e.target.checked) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(window.CALICE_VAPID_PUBLIC_KEY),
    });
    await api.post('/api/push/subscribe', sub.toJSON());
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
    navigate('#/login');
  });
}
```

- [ ] **Step 3: Manual verification**

Open `#/profile`. Expected: "Le mie cantine" shows the real count. Click "Invita" → a real invite URL appears containing an `#/invite/<code>` fragment; visiting that URL while logged in as a second account (or after logout/signup as a second user) and completing the invite-accept flow (Task 23's route guard should call `POST /api/invites/:code/accept` — add this one line to `main.js`'s `#/invite/:code` handling if not already present from Task 17) adds that user to the cellar, confirmed by them seeing the same bottles on `#/cellar`.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/js/screens/profile.js
git commit -m "feat: wire Profilo screen — invite, cellars count, push opt-in, logout"
```

---

### Task 23: Wine detail sheet wired (location, photos, notes)

**Files:**
- Create: `public/js/screens/detail.js`
- Modify: `public/index.html` (remove the mockup's fake price-comparison card and the fake translated English review; keep the location rack picker and photo gallery markup, give the notes tabs real containers)
- Modify: `public/js/screens/cellar.js` (open the detail sheet on row click, passing the bottle id)

**Interfaces:**
- Consumes: `api`.
- Produces: `openDetail(bottleId: number): Promise<void>`, called from `cellar.js`'s row click handler (added in Step 4) instead of just opening the empty overlay.

- [ ] **Step 1: In `public/index.html`, remove the fake content**

Delete the `.price-card` block and the second (English/"Traduci") `.rev-card` from the detail overlay's markup entirely, per the spec's "Catalog content: no fake web data" decision. Keep the vintage badge, photo gallery (`.gallery-row`), location rack picker, and the two-tab notes UI (`#tab-web`/`#tab-mine` containers — rename their ids to `#notes-others` and `#notes-mine` respectively, updating the tab click handler's `data-tab` values to `others`/`mine` to match).

- [ ] **Step 2: Write `public/js/screens/detail.js`**

```js
import { api } from '../api-client.js';

let currentBottleId = null;
let meId = null;

function noteHtml(n) {
  return `
    <div class="rev-card">
      <div class="rev-head"><div class="rev-avatar">${n.author_name.slice(0, 2).toUpperCase()}</div><div class="rev-name">${n.author_name}</div><span class="rev-src">${new Date(n.created_at).toLocaleDateString('it-IT')}</span></div>
      <div class="rev-stars">${'★'.repeat(Math.round(n.rating))}${'☆'.repeat(5 - Math.round(n.rating))}</div>
      <div class="rev-text">${n.text}</div>
    </div>`;
}

export async function openDetail(bottleId, me) {
  currentBottleId = bottleId;
  meId = me.id;
  const overlay = document.getElementById('detail-overlay');
  overlay.classList.add('open');

  const [notes, photos] = await Promise.all([
    api.get(`/api/bottles/${bottleId}/notes`),
    api.get(`/api/bottles/${bottleId}/photos`),
  ]);

  document.getElementById('notes-mine').innerHTML = notes.filter((n) => n.user_id === meId).map(noteHtml).join('');
  document.getElementById('notes-others').innerHTML = notes.filter((n) => n.user_id !== meId).map(noteHtml).join('') || '<p>Nessuna nota ancora da chi condivide o segui.</p>';

  const gallery = document.getElementById('detail-gallery');
  gallery.innerHTML =
    photos.map((p) => `<div class="gallery-thumb" style="background-image:url('${p.url}');background-size:cover;"></div>`).join('') +
    '<div class="gallery-add" id="gallery-add-btn"><input type="file" accept="image/*" capture="environment" style="display:none" id="gallery-file-input"></div>';
  document.getElementById('gallery-add-btn').addEventListener('click', () => document.getElementById('gallery-file-input').click());
  document.getElementById('gallery-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    await api.post(`/api/bottles/${bottleId}/photos`, form);
    openDetail(bottleId, me);
  });

  document.getElementById('note-submit')?.addEventListener('click', async () => {
    const text = document.getElementById('note-text').value.trim();
    const rating = document.querySelectorAll('.stars-input span.on').length || 3;
    if (!text) return;
    await api.post(`/api/bottles/${bottleId}/notes`, { rating, text });
    document.getElementById('note-text').value = '';
    openDetail(bottleId, me);
  }, { once: true });

  document.getElementById('detail-close')?.addEventListener('click', () => overlay.classList.remove('open'), { once: true });
}
```

- [ ] **Step 3: Wire the location rack picker to persist**

In `public/js/screens/detail.js`, append:

```js
document.getElementById('rack-save')?.addEventListener('click', async function saveLocation() {
  const selected = document.querySelector('.rack-slot.sel');
  const label = selected ? `Scaffale ${selected.dataset.shelf || '?'}` : null;
  if (label) await api.patch(`/api/bottles/${currentBottleId}`, { shelfLocation: label });
  document.getElementById('rack-panel').classList.remove('open');
});
```

Add a `data-shelf` attribute to each `.rack-slot` in `public/index.html` (e.g. `data-shelf="A3"`) so the label above is real instead of a placeholder.

- [ ] **Step 4: Open the detail sheet from `cellar.js` with a real bottle id**

In `public/js/screens/cellar.js`, add near the top:

```js
import { openDetail } from './detail.js';
import { me } from '../auth.js';
```

And in `renderList()`, after wiring delete buttons, add:

```js
list.querySelectorAll('.cellar-row').forEach((row) =>
  row.addEventListener('click', async () => {
    if (compareMode) return;
    await openDetail(Number(row.dataset.id), await me());
  }),
);
```

- [ ] **Step 5: Manual verification**

From `#/cellar`, tap a bottle row → detail sheet opens, "Le tue foto" shows any uploaded photos plus a working add-photo tile (file picker → uploads → reappears in the gallery), "Posizione fisica" edit → pick a slot → Salva → reopening the sheet shows the new location text, "Le tue note" tab shows a form that adds a note visible immediately, "Dalla community" tab shows nothing until a followed/cellar-sharing user adds one (confirms the Task 11 visibility scoping end-to-end). No price-comparison card or English review appears anywhere.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/screens/detail.js public/js/screens/cellar.js
git commit -m "feat: wire wine detail sheet — location, photos, notes; drop fake price/review content"
```

---

### Task 24: PWA manifest and service worker

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/sw.js`
- Modify: `public/index.html` (`<link rel="manifest">`, service worker registration script)

**Interfaces:**
- Produces: an installable app shell; no interface consumed by other tasks.

- [ ] **Step 1: Write `public/manifest.webmanifest`**

```json
{
  "name": "Calice",
  "short_name": "Calice",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f7f5f0",
  "theme_color": "#5b2333",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

(Generate `icon-192.png`/`icon-512.png` from the 🍷 favicon used across the mockup artifacts, or any square PNG placeholder for now — the manifest is otherwise complete.)

- [ ] **Step 2: Write `public/sw.js`**

```js
const CACHE = 'calice-shell-v1';
const SHELL_FILES = [
  '/', '/index.html', '/css/app.css',
  '/js/main.js', '/js/api-client.js', '/js/router.js', '/js/auth.js',
  '/js/screens/home.js', '/js/screens/cellar.js', '/js/screens/add.js',
  '/js/screens/stats.js', '/js/screens/profile.js', '/js/screens/detail.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES)));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // never cache API calls
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
```

- [ ] **Step 3: In `public/index.html`, add the manifest link and registration**

Add inside `<head>` (or the top of the file, since the mockup has no `<head>` — add one):

```html
<link rel="manifest" href="manifest.webmanifest">
```

Add before `</body>` (or at the end of the file):

```html
<script>
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
</script>
```

- [ ] **Step 4: Manual verification**

Serve `public/` over HTTPS (or `localhost`), open Chrome DevTools → Application → Manifest (shows Calice, no errors) → Service Workers (shows registered, activated). Go offline in DevTools' Network tab, reload — the app shell still loads (screens render, API calls fail gracefully since `mountX()` calls will reject — acceptable, matches the spec's "wine data requires network").

- [ ] **Step 5: Commit**

```bash
git add public/manifest.webmanifest public/sw.js public/index.html
git commit -m "feat: PWA manifest and offline app-shell service worker"
```

---

### Task 25: Deployment and README

**Files:**
- Create: `README.md`
- Modify: `worker/wrangler.jsonc` (finalize once real IDs exist)

**Interfaces:**
- Produces: a repeatable from-zero setup a future reader (including future-you) can follow without asking Fabio anything.

- [ ] **Step 1: Write `README.md`**

```markdown
# Calice

Wine cellar app. Worker API (Hono + D1 + R2) in `worker/`, static frontend in `public/`.

## First-time setup

    cd worker
    npm install
    npx wrangler login
    npx wrangler d1 create calice-db          # paste the returned database_id into wrangler.jsonc
    npx wrangler r2 bucket create calice-photos
    npx wrangler d1 migrations apply calice-db
    npm run db:seed
    npx wrangler secret put SESSION_SECRET     # any long random string
    npx web-push generate-vapid-keys           # then:
    npx wrangler secret put VAPID_PUBLIC_KEY
    npx wrangler secret put VAPID_PRIVATE_KEY

## Local development

    cd worker && npm run dev          # API on http://localhost:8787
    npx wrangler pages dev ../public  # frontend, in a second terminal

Set `window.CALICE_API_URL` and `window.CALICE_VAPID_PUBLIC_KEY` in `public/index.html`
(a small inline `<script>` before `js/main.js`) to point the frontend at the API
above and at the VAPID public key generated during setup.

## Deploy

    cd worker && npm run deploy                       # deploys the Worker
    npx wrangler pages deploy ../public --project-name=calice

Set the Pages project's production `PAGES_ORIGIN` value in `worker/wrangler.jsonc`
to the deployed Pages URL and redeploy the Worker so CORS allows it.

This is a separate Cloudflare Pages project and Worker from the existing
"roccamora" project — nothing here modifies it.

## Tests

    cd worker && npm test
```

- [ ] **Step 2: Set `PAGES_ORIGIN` for real once the Pages URL is known**

After the first `wrangler pages deploy`, copy the resulting `https://calice.pages.dev`-style URL into `worker/wrangler.jsonc`'s `vars.PAGES_ORIGIN`, then `npm run deploy` again in `worker/`.

- [ ] **Step 3: Full smoke test against the deployed URLs**

Visit the deployed Pages URL, sign up, add a bottle from the seeded catalog, confirm it appears on Home/Cantina/Statistiche, confirm the "Notifiche" toggle prompts for push permission.

- [ ] **Step 4: Commit**

```bash
git add README.md worker/wrangler.jsonc
git commit -m "docs: deployment and setup instructions"
```

---

## Self-Review

**Spec coverage** — every section of `docs/superpowers/specs/2026-09-01-calice-wine-cellar-design.md` maps to a task: Approach/frontend evolution → Task 17–23; Data model → Task 2; Catalog content (no fake data) → Task 11 (visibility-scoped notes) + Task 23 Step 1 (removes the fake price/review UI); Auth & sharing → Tasks 4, 6, 7; Scan & photos → Tasks 8, 12, 20 (barcode client-side, OCR explicitly excluded); Shared-cellar sync (no realtime) → implicit in every route being a plain read (no task adds Durable Objects); Notifications → Tasks 14, 15; PWA → Task 24; Deployment → Task 25; Testing → every backend task's TDD steps + each frontend task's manual verification script.

**Placeholders** — none; every step above contains complete, runnable code or an exact command with an exact expected result.

**Type/signature consistency** — checked across tasks: `score` (Task 9's SQL alias) is read as `bottle.score` in Task 18 and as `row.dataset.score` via `cellar.js`'s `rowHtml` (Task 19) and `detail.js` doesn't re-read it (correct — detail shows notes, not the aggregate). `isCellarMember(db, cellarId, userId)` is defined once in `worker/src/lib/cellars.ts` (Task 9, Step 1) and imported identically by `cellars.ts`, `bottles.ts`, `wishlist.ts`. `api.get/post/patch/del` (Task 17) is the only client import every screen module (18–23) uses, with matching call signatures throughout. `mountHome/mountCellar/mountAdd/mountStats/mountProfile` are each defined once and imported once in `main.js`.
