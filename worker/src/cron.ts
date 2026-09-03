import type { Env } from './index';

type SendFn = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, options: any) => Promise<unknown>;

// ponytail: web-push is imported lazily so this module loads without touching
// node:https unless a real send actually happens (tests always inject sendFn).
async function defaultSendFn(): Promise<SendFn> {
  const webpush = (await import('web-push')).default;
  return webpush.sendNotification.bind(webpush) as unknown as SendFn;
}

export async function runNotificationScan(env: Env, sendFn?: SendFn) {
  const send = sendFn ?? (await defaultSendFn());
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
    try {
      await send(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({ title, body }),
        { vapidDetails: { subject: 'mailto:fabio.stocco85@gmail.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } },
      );
      notified++;
    } catch (err) {
      // A single dead/expired subscription (a normal, expected state over
      // time) must not throw and take the rest of the day's batch down with
      // it — drop it so it stops being retried forever, and keep scanning.
      console.error('push send failed, removing subscription', row.endpoint, err);
      await env.DB.prepare('delete from push_subscriptions where endpoint = ?').bind(row.endpoint).run();
    }
  }
  return { notified };
}

const R2_FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB/month free storage
const R2_WARN_RATIO = 0.8; // warn at 8 GB, before any overage billing kicks in

// ponytail: re-warns every day the bucket stays over the threshold (no
// "already warned today" tracking — would need its own table/KV). Repeat
// warnings are the safer failure mode for a "tell me before I pay" alert;
// add dedup if the daily repeat gets annoying.
export async function checkPhotoStorageUsage(env: Env, sendFn?: SendFn) {
  let totalBytes = 0;
  let cursor: string | undefined;
  do {
    const page = await env.PHOTOS.list({ cursor });
    for (const obj of page.objects) totalBytes += obj.size;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  if (totalBytes < R2_FREE_TIER_BYTES * R2_WARN_RATIO) return { totalBytes, warned: false };

  const send = sendFn ?? (await defaultSendFn());
  const usedGb = (totalBytes / 1024 ** 3).toFixed(1);
  const rows = await env.DB.prepare('select endpoint, p256dh, auth from push_subscriptions').all<{ endpoint: string; p256dh: string; auth: string }>();
  for (const row of rows.results) {
    try {
      await send(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({
          title: 'Spazio foto quasi esaurito',
          body: `Hai usato ${usedGb} GB di 10 GB gratuiti su R2. Oltre iniziano i costi extra: valuta di eliminare qualche foto.`,
        }),
        { vapidDetails: { subject: 'mailto:fabio.stocco85@gmail.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } },
      );
    } catch (err) {
      console.error('push send failed, removing subscription', row.endpoint, err);
      await env.DB.prepare('delete from push_subscriptions where endpoint = ?').bind(row.endpoint).run();
    }
  }
  return { totalBytes, warned: true };
}

const TAVILY_FREE_TIER_CREDITS = 1000; // credits/month free, resets 1st of the month
const TAVILY_WARN_RATIO = 0.8; // warn at 800, before requests start failing

// ponytail: same re-warn-every-day tradeoff as checkPhotoStorageUsage above.
export async function checkSearchUsage(env: Env, sendFn?: SendFn) {
  const row = await env.DB
    .prepare(`select coalesce(sum(credits), 0) as total from tavily_usage where created_at >= date('now', 'start of month')`)
    .first<{ total: number }>();
  const totalCredits = row?.total ?? 0;

  if (totalCredits < TAVILY_FREE_TIER_CREDITS * TAVILY_WARN_RATIO) return { totalCredits, warned: false };

  const send = sendFn ?? (await defaultSendFn());
  const rows = await env.DB.prepare('select endpoint, p256dh, auth from push_subscriptions').all<{ endpoint: string; p256dh: string; auth: string }>();
  for (const row of rows.results) {
    try {
      await send(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({
          title: 'Crediti ricerca vini quasi esauriti',
          body: `Hai usato ${totalCredits} di 1000 crediti gratuiti Tavily questo mese. Oltre, la ricerca web si ferma fino al mese prossimo (o passa a un piano a pagamento).`,
        }),
        { vapidDetails: { subject: 'mailto:fabio.stocco85@gmail.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } },
      );
    } catch (err) {
      console.error('push send failed, removing subscription', row.endpoint, err);
      await env.DB.prepare('delete from push_subscriptions where endpoint = ?').bind(row.endpoint).run();
    }
  }
  return { totalCredits, warned: true };
}
