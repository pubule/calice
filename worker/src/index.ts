import { Hono } from 'hono';
import { authRoutes } from './routes/auth';
import { cellarRoutes, inviteRoutes } from './routes/cellars';
import { wineRoutes } from './routes/wines';
import { recognizeRoutes } from './routes/recognize';
import { cellarBottleRoutes, bottleRoutes, placeRoutes } from './routes/bottles';
import { cellarElementRoutes, elementRoutes } from './routes/elements';
import { cellarWishlistRoutes, wishlistItemRoutes } from './routes/wishlist';
import { noteRoutes, palateRoutes } from './routes/notes';
import { photoRoutes, photoFileRoutes } from './routes/photos';
import { followRoutes, activityRoutes } from './routes/follows';
import { pushRoutes } from './routes/push';
import { tastingRoutes } from './routes/tastings';
import { landscapeRoutes } from './routes/landscape';
import { wineImageRoutes, wineImageFileRoutes } from './routes/wine-image';
import { runNotificationScan, checkPhotoStorageUsage } from './cron';
import { runWeeklyBackup } from './lib/backup';

export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  AI: Ai;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  ACCESS_TEAM: string;
  ACCESS_AUD: string;
  CALICE_DEV_EMAIL?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);
app.route('/api/cellars', cellarRoutes);
app.route('/api/invites', inviteRoutes);
app.route('/api/wines', wineRoutes);
app.route('/api/wines/recognize', recognizeRoutes);
app.route('/api/wines', wineImageRoutes);
app.route('/api/wine-images', wineImageFileRoutes);
app.route('/api/landscape', landscapeRoutes);
app.route('/api/cellars', cellarBottleRoutes);
app.route('/api/bottles', bottleRoutes);
app.route('/api/places', placeRoutes);
app.route('/api/cellars', cellarElementRoutes);
app.route('/api/elements', elementRoutes);
app.route('/api/cellars', cellarWishlistRoutes);
app.route('/api/wishlist', wishlistItemRoutes);
app.route('/api/bottles', noteRoutes);
app.route('/api/bottles', photoRoutes);
app.route('/api/photos', photoFileRoutes);
app.route('/api/follows', followRoutes);
app.route('/api/me', activityRoutes);
app.route('/api/me', palateRoutes);
app.route('/api/push', pushRoutes);
app.route('/api/tastings', tastingRoutes);

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Env) => {
    // First and on its own: a failing push scan must not skip the copy.
    await runWeeklyBackup(env).catch((err) => console.error('backup failed', err));
    await runNotificationScan(env);
    await checkPhotoStorageUsage(env);
  },
};

export { app };
