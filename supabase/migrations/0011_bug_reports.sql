-- 0011_bug_reports.sql
--
-- STATUS: SUPERSEDED 2026-04-26 — DO NOT APPLY.
--
-- Originally drafted to back the in-window bug-report modal with a
-- queryable table. Sean's directive same day: bug reports go to
-- bugs@s3studio.xyz via email, no DB row. The modal now POSTs to
-- supabase/functions/bug-report (Edge Function + Resend) instead of
-- inserting here.
--
-- Left in tree as a no-op DDL block (BEGIN/ROLLBACK) so the file does
-- nothing if accidentally applied. If bug volume outgrows email-as-
-- triage and we need a queryable surface again, resurrect this from
-- git history rather than appending another migration on top of a
-- ROLLBACK'd file.
--
-- Original DDL kept inside the rollback for reference.

BEGIN;
ROLLBACK;
-- Nothing below this line will run. Original DDL preserved as a
-- comment for resurrection if needed.
/*

CREATE TABLE IF NOT EXISTS public.bug_reports (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    -- Window context auto-attached by the modal.
    app_id          text,
    window_title    text,
    page_url        text,
    user_agent      text,
    -- User-supplied content.
    description     text NOT NULL,
    severity        text CHECK (severity IN ('low', 'medium', 'high', 'blocker')),
    screenshot_url  text,
    -- Triage fields (filled by admin tooling later).
    status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate')),
    triaged_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    triage_notes    text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bug_reports_status_idx
    ON public.bug_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS bug_reports_user_idx
    ON public.bug_reports (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

-- Anyone can submit a bug report (anon or authed). No SELECT permission.
CREATE POLICY "anyone can insert bug reports"
    ON public.bug_reports
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Admins can read all bug reports for triage.
CREATE POLICY "admins read all bug reports"
    ON public.bug_reports
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('admin', 'support')
        )
    );

-- Admins can update for triage.
CREATE POLICY "admins update bug reports"
    ON public.bug_reports
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

-- updated_at trigger.
CREATE OR REPLACE FUNCTION public.bug_reports_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER bug_reports_updated_at
    BEFORE UPDATE ON public.bug_reports
    FOR EACH ROW
    EXECUTE FUNCTION public.bug_reports_set_updated_at();

COMMIT;
*/
