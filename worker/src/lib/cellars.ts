export async function isCellarMember(db: D1Database, cellarId: number, userId: number): Promise<boolean> {
  const row = await db
    .prepare('select 1 from cellar_members where cellar_id = ? and user_id = ?')
    .bind(cellarId, userId)
    .first();
  return row !== null;
}
