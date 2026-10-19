// Every user has their own wines (migration 0020). A wine id the user does
// not own (a search result is often another user's wine) becomes the user's
// own wine here: the one they already have with the same name, producer and
// vintage, or a copy. Either way its empty fields are filled from the most
// complete record of that wine among everyone's, so adding a wine always
// keeps the best data known.

// The fields that make a record "more complete" (and are filled in).
export const DETAIL_FIELDS = ['region', 'denomination', 'grape_variety', 'alcohol', 'producer_url', 'image_url',
  'vivino_rating', 'vivino_ratings_count', 'barcode'] as const;

export const completeness = (w: Record<string, unknown>) => DETAIL_FIELDS.filter((f) => w[f] != null && w[f] !== '').length;

// Same wine: name and producer (case and spaces ignored) and vintage.
const SAME = `lower(trim(name)) = lower(trim(?)) and lower(trim(producer)) = lower(trim(?)) and vintage is ?`;

type WineRow = Record<string, unknown> & { id: number; name: string; producer: string; vintage: number | null; owner_id: number | null };

export async function ownWineId(db: D1Database, wineId: number, userId: number): Promise<number | null> {
  const wine = await db.prepare('select * from wines where id = ?').bind(wineId).first<WineRow>();
  if (!wine) return null;
  // A wine nobody owns yet (older rows, seeded catalogue) becomes the first user's.
  if (wine.owner_id == null) {
    await db.prepare('update wines set owner_id = ? where id = ? and owner_id is null').bind(userId, wineId).run();
    wine.owner_id = (await db.prepare('select owner_id from wines where id = ?').bind(wineId).first<{ owner_id: number }>())!.owner_id;
  }
  const same = (await db.prepare(`select * from wines where ${SAME}`).bind(wine.name, wine.producer, wine.vintage).all<WineRow>()).results;
  const best = same.reduce((a, b) => (completeness(b) > completeness(a) ? b : a), wine);
  const mine = wine.owner_id === userId ? wine : same.filter((w) => w.owner_id === userId).sort((a, b) => a.id - b.id)[0];
  if (mine) {
    if (best.id !== mine.id) {
      await db
        .prepare(`update wines set ${DETAIL_FIELDS.map((f) => `${f} = coalesce(nullif(${f}, ''), ?)`).join(', ')}, search_text = null where id = ?`)
        .bind(...DETAIL_FIELDS.map((f) => best[f] ?? null), mine.id)
        .run();
    }
    return mine.id;
  }
  const created = await db
    .prepare(
      `insert into wines (name, producer, country, type, vintage, ${DETAIL_FIELDS.join(', ')}, source, created_by, owner_id)
       select name, producer, country, type, vintage, ${DETAIL_FIELDS.join(', ')}, source, ?, ? from wines where id = ? returning id`,
    )
    .bind(userId, userId, best.id)
    .first<{ id: number }>();
  return created!.id;
}

export async function ownsWine(db: D1Database, wineId: number, userId: number): Promise<boolean> {
  return (await db.prepare('select 1 from wines where id = ? and owner_id = ?').bind(wineId, userId).first()) !== null;
}
