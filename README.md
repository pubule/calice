# Calice

Wine cellar app. One Worker (Hono API under `/api/*` + static assets under
`public/`) serves both the frontend and the backend from the same origin.
Source for the API lives in `worker/src/`; deploy config is the root
`wrangler.jsonc`.

## Live

- https://calice.smartcores.org

Separate Cloudflare project from the existing "roccamora"/"Budget" projects
on the same account — nothing here touches them, though it reuses the same
Zero Trust team (`smartcores`) and domain (`smartcores.org`).

## Auth

No password/signup flow. **Cloudflare Access** sits in front of
`calice.smartcores.org`: it gates the whole site with Google login, checked
against an email allowlist configured in the Access Application's policy
(Zero Trust dashboard, not this repo). The Worker verifies the
`Cf-Access-Jwt-Assertion` header's signature itself (`worker/src/lib/access.ts`)
rather than trusting Cloudflare's edge alone — see the comment there for why.
A user's row (and their first cellar) is created lazily on their first
authenticated request (`worker/src/lib/session.ts`).

For local dev/tests, set `CALICE_DEV_EMAIL` (never in `wrangler.jsonc` —
it's a `wrangler dev --var` only) to impersonate an email without a real
Access JWT; the `X-Calice-Dev-Email` header picks which one, mirroring
`ombre-su-roccamora`'s `OSR_DEV_EMAIL` pattern.

## First-time setup

    npm install
    npx wrangler login
    npx wrangler d1 create calice-db          # paste the returned database_id into wrangler.jsonc
    npx wrangler r2 bucket create calice-photos
    cd worker && npx wrangler d1 migrations apply calice-db --remote && cd ..
    npx wrangler d1 execute calice-db --remote --file=./worker/seed/wines.sql
    npx web-push generate-vapid-keys          # then:
    npx wrangler secret put VAPID_PUBLIC_KEY
    npx wrangler secret put VAPID_PRIVATE_KEY

Then, in the Zero Trust dashboard (one-time, not automatable — no API token
here has Access:Edit scope): Access -> Applications -> Add an application ->
Self-hosted, domain `calice.smartcores.org`, Google as the only identity
provider, an "allow" policy listing the emails that may sign in. Copy the
app's Application Audience (AUD) Tag into `wrangler.jsonc`'s
`vars.ACCESS_AUD`.

## Local development

    npx wrangler dev --var CALICE_DEV_EMAIL:you@example.com

Serves both the frontend and `/api/*` from one local server, with
`CALICE_DEV_EMAIL` standing in for a real Access login.

## Deploy

    npx wrangler deploy

Deploys both the static frontend and the API as one Worker. Do **not**
deploy this with a placeholder `ACCESS_AUD` and `workers_dev: true`/no
`routes` — either leaves the live site open with no authentication at all,
since there's no password fallback anymore.

### R2 note

R2 was not enabled on this Cloudflare account at first deploy (`dash.cloudflare.com`
-> R2 -> enable — a one-time manual step). If `r2_buckets` in `wrangler.jsonc`
doesn't match a bucket that exists yet, `wrangler deploy` refuses to deploy;
temporarily comment out the `r2_buckets` block, deploy, then restore it
(needed for local tests — `vitest-pool-workers` simulates R2 regardless of
whether the real bucket exists). Once enabled:

    npx wrangler r2 bucket create calice-photos
    npx wrangler deploy

## Tests

    cd worker && npm test
