-- 0016_subscriptions_provider_sub_id_unique.sql
--
-- STATUS: APPLIED via MCP 2026-05-03 SGT.
-- Project: Everywear (ykqdsihnzroglepoxwcj). Migration tracker
-- reconciled: this file's name matches the row in
-- supabase_migrations.schema_migrations as version '0016'. Running
-- `supabase db push` again is a no-op.
--
-- Partial UNIQUE index on subscriptions.provider_sub_id. Required for
-- idempotent webhook upserts (ON CONFLICT(provider_sub_id) DO UPDATE).
-- Lemon Squeezy retries webhook deliveries and we need to fold repeats
-- into the same row instead of inserting duplicates.
--
-- Partial (WHERE NOT NULL) so admin_override / demo rows that have no
-- provider_sub_id stay valid. Real provider IDs (LS, Xendit) MUST be
-- globally unique within their provider — collisions across providers
-- are a non-issue because LS uses numeric strings and Xendit uses
-- different prefixes.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_sub_id_unique
    ON public.subscriptions (provider_sub_id)
    WHERE provider_sub_id IS NOT NULL;

-- Drop the old non-unique index since the new unique partial index
-- covers the same lookup pattern. Saves one B-tree on writes.
DROP INDEX IF EXISTS public.subscriptions_provider_sub_id_idx;

COMMIT;
