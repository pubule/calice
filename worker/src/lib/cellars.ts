export async function isCellarMember(db: D1Database, cellarId: number, userId: number): Promise<boolean> {
  const row = await db
    .prepare('select 1 from cellar_members where cellar_id = ? and user_id = ?')
    .bind(cellarId, userId)
    .first();
  return row !== null;
}

// One cellar per user (the places inside it are the cellar's elements). Made
// at signup, and again when the user deletes theirs: every screen counts on it.
export const DEFAULT_CELLAR_NAME = 'Casa';

export async function ensureCellar(db: D1Database, userId: number): Promise<number> {
  const mine = await db.prepare('select cellar_id from cellar_members where user_id = ? order by cellar_id limit 1').bind(userId).first<{ cellar_id: number }>();
  if (mine) return mine.cellar_id;
  const cellar = await db.prepare('insert into cellars (name, owner_id) values (?, ?) returning id').bind(DEFAULT_CELLAR_NAME, userId).first<{ id: number }>();
  await db.prepare(`insert into cellar_members (cellar_id, user_id, role) values (?, ?, 'owner')`).bind(cellar!.id, userId).run();
  return cellar!.id;
}
