import { Hono } from 'hono';
import { authRoutes } from './routes/auth';
import { cellarRoutes, inviteRoutes } from './routes/cellars';
import { wineRoutes } from './routes/wines';
import { cellarBottleRoutes, bottleRoutes } from './routes/bottles';
import { cellarWishlistRoutes, wishlistItemRoutes } from './routes/wishlist';
import { noteRoutes } from './routes/notes';
import { photoRoutes, photoFileRoutes } from './routes/photos';

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
app.route('/api/cellars', cellarRoutes);
app.route('/api/invites', inviteRoutes);
app.route('/api/wines', wineRoutes);
app.route('/api/cellars', cellarBottleRoutes);
app.route('/api/bottles', bottleRoutes);
app.route('/api/cellars', cellarWishlistRoutes);
app.route('/api/wishlist', wishlistItemRoutes);
app.route('/api/bottles', noteRoutes);
app.route('/api/bottles', photoRoutes);
app.route('/api/photos', photoFileRoutes);

export default {
  fetch: app.fetch,
};

export { app };
