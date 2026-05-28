-- 0002_subscriptions.sql
--
-- Subscription state per user. Written exclusively by the Edge Function
-- webhooks (lemon-squeezy-webhook, xendit-webhook) using the service-role
-- key. Read by RLS-enabled tier gates and by the client (users see their
-- own subscription).
--
-- One user can have multiple subscription rows over time (e.g. cancel,
-- re-subscribe, upgrade from Gener8 to Pro). The "current" row is the
-- latest with status='active'. A Postgres function active_tier(uuid)
-- wraps that lookup for RLS policy use.
--
-- Tier enum: 'demo' / 'gener8' / 'gener8_pro' / 'creator_studio'.
--   demo           — 60-min server-clocked trial (demo_started_at stamped)
--   gener8         — $5/mo base
--   gener8_pro     — $12.99/mo base + better_models pack
--   creator_studio — $30/mo, coming soon at ship (gate returns 'coming_soon')

BEGIN;

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tier                text NOT NULL CHECK (tier IN (
                            'demo', 'gener8', 'gener8_pro', 'creator_studio')),
    status              text NOT NULL CHECK (status IN (
                            'active', 'past_due', 'cancelled', 'expired', 'paused')),
    provider            text NOT NULL CHECK (provider IN ('lemon_squeezy', 'xendit', 'demo')),
    provider_sub_id     text,                     -- LS subscription_id / Xendit plan_id
    started_at          timestamptz NOT NULL DEFAULT now(),
    current_period_end  timestamptz,
    cancelled_at        timestamptz,
    demo_started_at     timestamptz,              -- for tier='demo' only
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS subscriptions_provider_sub_id_idx ON public.subscriptions (provider_sub_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON public.subscriptions (status) WHERE status = 'active';

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read only their own subscription rows.
CREATE POLICY "users read own subscriptions"
    ON public.subscriptions
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE for users. Only the service-role key (Edge
-- Functions) can write. Service-role bypasses RLS by design, so no
-- policy needed for writes — the absence of policies means no auth
-- user can ever write. That's intentional.

-- Helper: return the active tier for a user, or NULL if no active row.
-- Used by RLS policies elsewhere and by the demo clock path.
CREATE OR REPLACE FUNCTION public.active_tier(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT tier
    FROM public.subscriptions
    WHERE user_id = p_user
      AND status = 'active'
    ORDER BY started_at DESC
    LIMIT 1;
$$;

-- Demo clock helper: returns true if user has an active demo row and
-- fewer than 60 minutes have elapsed since demo_started_at.
CREATE OR REPLACE FUNCTION public.demo_active(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.subscriptions
        WHERE user_id = p_user
          AND tier = 'demo'
          AND status = 'active'
          AND demo_started_at IS NOT NULL
          AND demo_started_at > now() - interval '60 minutes'
    );
$$;

-- updated_at auto-touch.
CREATE OR REPLACE FUNCTION public._touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subscriptions_touch ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_touch
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

COMMIT;
