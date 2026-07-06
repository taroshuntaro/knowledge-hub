-- pg_bigm による日本語部分一致検索の GIN 式インデックス。
-- インデックスは LIKE の結果を変えず加速するだけなので、pg_bigm が無い環境
-- （テスト用 postgres:16-alpine 等）では作成をスキップして migration を成功させる。
-- 本番での extension 欠如はサーバー起動時の警告ログで検知する（src/index.ts）。
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_bigm;
  CREATE INDEX IF NOT EXISTS articles_search_text_bigm_idx
    ON articles USING gin (lower(search_text) gin_bigm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_bigm unavailable, skipping search index: %', SQLERRM;
END $$;
