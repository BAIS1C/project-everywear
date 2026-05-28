-- 0017_webhook_events_dedupe.sql
--
-- STATUS: APPLIED via MCP 2026-05-03 SGT.
-- Project: Everywear (ykqdsihnzroglepoxwcj). Migration tracker
-- reconciled: this file's name matches version '0017' in
-- supabase_migrations.schema_migrations.
--
-- Event-level deduplication for webhooks. LS retries failed deliveries
-- and can also redeliver succeeded ones if the dashboard is replayed.
-- Without dedupe, duplicate subscription_created events would double-
-- credit referral rewards (each qualified referral grants +1 month;
-- duplicate events would grant +2). Most other webhook actions are
-- idempotent at the row level (upsert by provider_sub_id, status flips
-- to fixed values), but the referral side-effect is NOT idempotent
-- and needs event-level protection.
--
-- Strategy: dispatcher INSERTs first; on PK conflict the event was
-- already processed and we short-circuit to 200 OK. Insert before
-- side effects so duplicate retries can't slip through a race window.

BEGIN;

CREATE TABLE IF NOT EXISTS public.webhook_events (
    provider     text NOT NULL CHECK (provider IN ('lemon_squeezy', 'xendit')),
    webhook_id   text NOT NULL,
    event_name   text,
    received_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, webhook_id)
);

CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx
    ON public.webhook_events (received_at DESC);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

COMMIT;
