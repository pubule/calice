-- Tables of features removed in build 153-154 (personal app: no friends'
-- activity, invites, follows or push notifications). Nothing reads them any
-- more; on 2026-10-19 production held 42 activity rows, 3 unused invite codes
-- and no follows or subscriptions. D1 bookmark before this migration:
-- 000001b1-00000000-00005109-4432a6a636e9920b6cda5ad5bab46a7a
DROP TABLE IF EXISTS activity_feed;
DROP TABLE IF EXISTS cellar_invites;
DROP TABLE IF EXISTS follows;
DROP TABLE IF EXISTS push_subscriptions;

-- Landscapes remembered as links to Wikimedia Commons (before the photos
-- lived in R2, build 162): never served any more, searched again if needed.
DELETE FROM landscapes WHERE url LIKE 'http%';
