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
