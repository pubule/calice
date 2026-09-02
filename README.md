# Calice

Wine cellar app. Worker API (Hono + D1 + R2) in `worker/`, static frontend in `public/`.

## Live

- API: https://calice-api.fabio-stocco85.workers.dev
- App: https://calice.fabio-stocco85.workers.dev

Separate Cloudflare Pages/Workers projects from the existing "roccamora" project — nothing here touches it.

## First-time setup

    cd worker
    npm install
    npx wrangler login
    npx wrangler d1 create calice-db          # paste the returned database_id into wrangler.jsonc
    npx wrangler r2 bucket create calice-photos
    npx wrangler d1 migrations apply calice-db --remote
    npm run db:seed
    npx wrangler secret put SESSION_SECRET     # any long random string
    npx web-push generate-vapid-keys           # then:
    npx wrangler secret put VAPID_PUBLIC_KEY
    npx wrangler secret put VAPID_PRIVATE_KEY

## Local development

    cd worker && npm run dev          # API on http://localhost:8787
    npx wrangler pages dev ../public  # frontend, in a second terminal

For local dev, `window.CALICE_API_URL` defaults to `http://localhost:8787` in
`public/js/api-client.js` — no config needed. `window.CALICE_VAPID_PUBLIC_KEY`
is set inline in `public/index.html` (see the production value below to know
what shape to use for a fresh local VAPID key pair, if you generate your own).

## Deploy

    cd worker && npx wrangler deploy                  # deploys the Worker
    npx wrangler pages deploy ../public --project-name=calice

Set `window.CALICE_API_URL` / `window.CALICE_VAPID_PUBLIC_KEY` in
`public/index.html` (small inline `<script>` right before `js/main.js`) to
the deployed Worker URL and your VAPID public key before deploying Pages.

Set the Pages project's resulting URL as `worker/wrangler.jsonc`'s
`vars.PAGES_ORIGIN`, then `npx wrangler deploy` the Worker again so CORS
allows it.

### R2 note

R2 was not enabled on this Cloudflare account at deploy time (`dash.cloudflare.com`
-> R2 -> enable — a one-time manual step). `worker/wrangler.jsonc` keeps the
`r2_buckets` binding declared (needed for local tests — `vitest-pool-workers`
simulates R2 locally regardless of whether the real bucket exists) but the
**currently deployed** Worker was deployed from a build with that binding
temporarily removed, since `wrangler deploy` refuses to deploy if a declared
R2 bucket doesn't exist in the account. That means the live app works for
everything except photo upload/list (`POST`/`GET /api/bottles/:id/photos`,
which will 500). Once R2 is enabled:

    npx wrangler r2 bucket create calice-photos
    cd worker && npx wrangler deploy

The committed `wrangler.jsonc` already has the `r2_buckets` block — no edit
needed, just redeploy once the bucket exists. Nothing else in the app depends
on R2.

## Tests

    cd worker && npm test
