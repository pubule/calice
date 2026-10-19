// The same wine in another vintage: the vintage is part of a wine row, so
// another year is another row. Reuses the one with the same name and
// producer if it exists, otherwise copies the wine's data (photo included)
// with the new vintage. Returns its id.
export async function wineOfVintage(db: D1Database, wineId: number, vintage: number | null, userId: number): Promise<number> {
  const wine = await db.prepare('select id, name, producer, vintage from wines where id = ? and owner_id = ?').bind(wineId, userId)
    .first<{ id: number; name: string; producer: string; vintage: number | null }>();
  if (!wine) throw new Error('wine not found');
  if ((wine.vintage ?? null) === vintage) return wine.id;
  const existing = await db
    .prepare(
      `select id from wines where lower(trim(name)) = lower(trim(?)) and lower(trim(producer)) = lower(trim(?)) and vintage is ?
         and owner_id = ?
       order by id limit 1`,
    )
    .bind(wine.name, wine.producer, vintage, userId)
    .first<{ id: number }>();
  if (existing) return existing.id;
  const created = await db
    .prepare(
      `insert into wines (name, producer, region, country, type, vintage, grape_variety, denomination, image_url,
         vivino_rating, vivino_ratings_count, alcohol, producer_url, source, created_by, owner_id)
       select name, producer, region, country, type, ?, grape_variety, denomination, image_url,
         vivino_rating, vivino_ratings_count, alcohol, producer_url, 'custom', ?, ?
       from wines where id = ? returning id`,
    )
    .bind(vintage, userId, userId, wine.id)
    .first<{ id: number }>();
  return created!.id;
}
