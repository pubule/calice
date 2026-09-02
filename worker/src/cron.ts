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
