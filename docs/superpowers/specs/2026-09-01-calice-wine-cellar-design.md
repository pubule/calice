# Calice — wine cellar app design

## Context

Fabio wants a mobile-first webapp to manage his personal/shared wine cellar: search and add wines, track physical location in the cellar, tasting notes, drink-window alerts, and stats. The visual design and full feature set were explored through a series of interactive HTML mockups (`mockups/calice.html` in this repo), iterated with the user and approved. This spec turns that approved UI/UX into a buildable architecture, to be deployed on the user's existing Cloudflare account (alongside an existing project, "roccamora").

The mockup already defines: 5 primary sections (Home, Cantina, Aggiungi, Statistiche, Profilo), a wine detail sheet (location picker, photo gallery, tasting notes, price paid), a wishlist, a two-wine comparison flow, multi-cellar and multi-country support, and a social layer (follow, activity feed). This spec's job is to give all of that a real data model, auth, and hosting story — not to change the UX.

## Approach

**Frontend:** evolve the existing static prototype (`mockups/calice.html`) into the real app instead of rewriting it in a framework. The prototype already implements every screen, transition, and interaction correctly; the work left is modularizing it (separate JS/CSS files, a small hash-based router so each of the 5 sections + detail sheets are real routable views) and replacing its hardcoded sample data with calls to the API below. This is the lazy, correct choice — a framework rewrite would re-solve problems the prototype has already solved for no user-visible benefit.

**Backend:** Cloudflare Workers (API), D1 (relational data), R2 (photos), a Cron Trigger (scheduled checks), and Web Push (notifications). All within the user's existing Cloudflare account, as a second project alongside roccamora — comfortably inside the free-tier project limits.

**Wine catalog:** a curated seed dataset in D1 rather than a live external wine API. Keeps the app free of a third-party data contract before it's proven useful; the catalog is extended manually (and by users adding wines that aren't in it yet — see Data model).

## Data model (D1)

- `users` — id, email, password_hash, name, created_at
- `cellars` — id, name, owner_id (supports "Le mie cantine" / multi-cellar)
- `cellar_members` — cellar_id, user_id, role (owner/member) — powers sharing/invite
- `wines` — id, name, producer, region, country, type (rosso/bianco/bollicine/rosato), vintage, barcode, source (`catalog` seeded or `custom` user-added)
- `bottles` — id, cellar_id, wine_id, quantity, price_paid, shelf_location, added_by, added_at — the owned-inventory row shown in "La mia cantina"
- `wishlist_items` — id, cellar_id, wine_id, target_price, added_by
- `tasting_notes` — id, bottle_id, user_id, rating, text, created_at — personal notes; the "reviews" tab on a wine's detail sheet shows notes from the current user plus anyone they follow or share a cellar with (see Catalog content below)
- `photos` — id, bottle_id, r2_key, uploaded_by — bottle photo gallery
- `follows` — follower_id, followee_id
- `activity_feed` — id, user_id, cellar_id, wine_id, action (`added`/`drank`), created_at — powers the Home "Attività amici" section

## Catalog content: no fake web data

The mockup's "prezzo di mercato / confronto negozi" and "recensioni dalla community dal web" are, without a licensed external data source, not real data. Rather than fake it with a hand-curated static dataset that goes stale, this spec drops both:

- **Price** shows only `price_paid` — what the user actually entered when adding the bottle. No live market comparison.
- **Reviews** on a wine's detail sheet show only `tasting_notes` from the current user and people they follow or share a cellar with. The "community" feel comes from the real social graph (`follows`, shared `cellars`), not from scraped or invented content.

This is a straightforward, buildable substitute that keeps every screen from the mockup, just backed by real data instead of placeholder web content.

## Auth & sharing

Email + password. Password hashed with PBKDF2 via the Web Crypto API (`SubtleCrypto`, natively available in Workers — no external crypto library needed) and stored in `users.password_hash`; sessions via a signed, httpOnly cookie issued by the Worker. Sharing a cellar generates an invite link/code tied to a `cellar_id`; accepting it (after signup or login) inserts a `cellar_members` row. No third-party OAuth dependency for v1.

## Scan & photos

- **Barcode**: decoded client-side (the browser's `BarcodeDetector` API where available, a JS fallback library otherwise) and matched against `wines.barcode` in D1. No server round-trip for the scan itself.
- **Label photo**: captured via the device camera and uploaded to R2 as a `photos` row — this is what populates the "Le tue foto" gallery on the wine detail sheet. Automatic label text recognition (OCR to auto-fill name/producer) is explicitly **out of scope for this spec** — it's accuracy-sensitive enough to be its own piece of work, so v1 label-scan falls back to text search. Revisit once the core app is live.

## Shared-cellar sync

No realtime layer. The Worker API reads current state from D1 on every screen load and on pull-to-refresh; a family sharing a cellar sees each other's changes on next open, not instantly. This matches how the mockup already behaves (nothing in the UI implies live push updates) and avoids Durable Objects complexity that nothing in the current feature set actually needs.

## Notifications

A daily Cloudflare Cron Trigger scans `bottles` for entries whose drink window has opened and for quantities under a low-stock threshold, then sends a Web Push notification to devices of users who enabled "Notifiche" in Profilo (subscription endpoints stored per-user). This mirrors the two alert banners already in the Home mockup — the Cron job is what would trigger them for real, instead of them always being present.

## PWA

A manifest and service worker make the app installable to the home screen with an offline app shell (static UI works offline; wine data requires network, matching the "definitely-needs-a-network" nature of a shared multi-user cellar).

## Deployment

One Cloudflare Pages project (static frontend) plus one Worker (API, with D1 and R2 bindings), both new resources in the user's existing Cloudflare account, independent of roccamora. The current mockup (`mockups/calice.html`) can continue to be published standalone (e.g. as an Artifact or a throwaway Pages preview) for reference — it is not part of the production deployment.

## Testing

- Worker API: unit tests per route (auth, bottles CRUD, wishlist, invite flow) against a local D1 (Miniflare/Wrangler dev).
- Frontend: manual verification against the real API by walking each of the 5 sections + detail sheet + comparison flow, the same way the mockup was verified — since the UI is carried over from the approved prototype rather than rebuilt, the main testing risk is the API integration, not the UI itself.
- Cron notification job: tested by seeding a bottle with a past drink-window date / low quantity and confirming a push fires, via a manually-triggered Wrangler cron test run.
