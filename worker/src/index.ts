import { Hono } from 'hono';
import { authRoutes } from './routes/auth';
import { cellarRoutes } from './routes/cellars';
import { wineRoutes } from './routes/wines';
import { recognizeRoutes } from './routes/recognize';
import { cellarBottleRoutes, bottleRoutes, placeRoutes } from './routes/bottles';
import { cellarElementRoutes, elementRoutes } from './routes/elements';
import { cellarWishlistRoutes, wishlistItemRoutes } from './routes/wishlist';
import { noteRoutes, palateRoutes } from './routes/notes';
import { photoRoutes, photoFileRoutes } from './routes/photos';
import { landscapeRoutes, landscapeImageRoutes } from './routes/landscape';
import { wineImageRoutes, wineImageFileRoutes, copyExternalImages } from './routes/wine-image';
import { runWeeklyBackup } from './lib/backup';
import { ZONES } from './lib/landscape-zones';
import { backupRoutes } from './routes/backup';

export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  AI: Ai;
  ACCESS_TEAM: string;
  ACCESS_AUD: string;
  CALICE_DEV_EMAIL?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);
app.route('/api/cellars', cellarRoutes);
app.route('/api/wines', wineRoutes);
app.route('/api/wines/recognize', recognizeRoutes);
app.route('/api/wines', wineImageRoutes);
app.route('/api/wine-images', wineImageFileRoutes);
app.route('/api/landscape', landscapeRoutes);
app.route('/api/landscape-images', landscapeImageRoutes);
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
app.route('/api/me', palateRoutes);
app.route('/api/backup', backupRoutes);

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Env) => {
    await copyExternalImages(env).catch(() => {}); // before the backup, so it holds the copies
    await runWeeklyBackup(env, new Date(), ZONES.flatMap((z) => z.photos.map((p) => p.key)));
  },
};

export { app };
