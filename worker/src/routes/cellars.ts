import { Hono } from 'hono';
import { requireAuth } from '../lib/session';
import { isCellarMember } from '../lib/cellars';
import type { Env } from '../index';

export { isCellarMember };

export const cellarRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
cellarRoutes.use('*', requireAuth);

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

cellarRoutes.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await isCellarMember(c.env.DB, id, c.get('userId')))) return c.json({ error: 'not a member' }, 403);
  const { name } = await c.req.json<{ name: string }>();
  const cellar = await c.env.DB.prepare('update cellars set name = ? where id = ? returning *').bind(name, id).first();
  return c.json(cellar);
});
