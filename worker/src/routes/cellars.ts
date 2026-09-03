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

cellarRoutes.post('/:id/invite', async (c) => {
  const cellarId = Number(c.req.param('id'));
  const userId = c.get('userId');
  if (!(await isCellarMember(c.env.DB, cellarId, userId))) return c.json({ error: 'not a member' }, 403);
  const code = crypto.randomUUID();
  await c.env.DB
    .prepare('insert into cellar_invites (code, cellar_id, created_by) values (?, ?, ?)')
    .bind(code, cellarId, userId)
    .run();
  return c.json({ code });
});

export const inviteRoutes = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
inviteRoutes.use('*', requireAuth);

inviteRoutes.post('/:code/accept', async (c) => {
  const code = c.req.param('code');
  const invite = await c.env.DB
    .prepare('select cellar_id from cellar_invites where code = ?')
    .bind(code)
    .first<{ cellar_id: number }>();
  if (!invite) return c.json({ error: 'invalid invite code' }, 404);
  await c.env.DB
    .prepare('insert or ignore into cellar_members (cellar_id, user_id, role) values (?, ?, ?)')
    .bind(invite.cellar_id, c.get('userId'), 'member')
    .run();
  return c.json({ cellarId: invite.cellar_id });
});
