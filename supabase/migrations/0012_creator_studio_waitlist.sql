-- 0012_creator_studio_waitlist.sql
--
-- STATUS: DRAFT — do not `supabase db push` until reviewed.
--
-- Email capture for users hitting locked Creator Studio panels in the
-- demo build. Wires up to ComingSoonSheet's "Notify me when available"
-- form. Also serves the same role for any other 'soon' applet in the
-- registry (DAW, Trading Post, Forum), so the table is keyed by
-- app_id rather than locked to Creator Studio specifically.
--
-- Anyone (anon or authed) can insert. Admins read for outbound launch
-- comms. Unique constraint on (app_id, email) so the same address
-- can sign up for multiple apps but not duplicate within one app.

BEGIN;

CREATE TABLE IF NOT EXISTS public.waitlist_signups (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    app_id          text NOT NULL,
    app_label       text,
    email           text NOT NULL,
    -- Optional context for triage / segmentation.
    referrer        text,
    user_agent      text,
    -- Track whether the user was authed at signup time (segmentation).
    was_authed      boolean NOT NULL DEFAULT false,
    -- Outbound notification state.
    notified        boolean NOT NULL DEFAULT false,
    notified_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (app_id, email)
);

CREATE INDEX IF NOT EXISTS waitlist_signups_app_idx
    ON public.waitlist_signups (app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS waitlist_signups_user_idx
    ON public.waitlist_signups (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

-- Anyone can sign up for the waitlist.
CREATE POLICY "anyone can join waitlist"
    ON public.waitlist_signups
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Authed users can see their own signups (so the UI can render
-- "you're on the waitlist" without a separate read endpoint).
CREATE POLICY "user reads own waitlist signups"
    ON public.waitlist_signups
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Admins read all for outbound comms.
CREATE POLICY "admins read all waitlist"
    ON public.waitlist_signups
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('admin', 'support')
        )
    );

-- Admins can flip notified status.
CREATE POLICY "admins update waitlist"
    ON public.waitlist_signups
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('admin', 'support')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('admin', 'support')
        )
    );

COMMIT;
