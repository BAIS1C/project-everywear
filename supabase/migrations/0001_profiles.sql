-- 0001_profiles.sql
--
-- Profile table anchored to auth.users. One row per user, created on
-- signup via the handle_new_user() trigger on auth.users.
--
-- Fields:
--   id            uuid PK, mirrors auth.users.id (same value, FK enforced)
--   handle        text, the @{handle}.everywear.id identity — IMMUTABLE once set
--                 (wallet binding target). Gated by ensure_handle_allowed()
--                 trigger installed in 0003.
--   handle_folded text, populated by the same trigger for fast collision /
--                 @mention lookups. Unique index.
--   display_name  text, mutable public label shown in UI. Users can change
--                 freely; no uniqueness.
--   role          text, one of 'user' / 'admin' / 'mod' / 'support'. Default
--                 'user'. Used by assign_reserved() + mod actions.
--   created_at    timestamptz
--
-- RLS is on by default (event trigger auto_enable_rls installed manually
-- in the SQL editor 2026-04-22). Explicit ENABLE below for belt-and-braces
-- and repo visibility.

BEGIN;

CREATE TABLE IF NOT EXISTS public.profiles (
    id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    handle          text NOT NULL,
    handle_folded   text,                         -- populated by trigger in 0003
    display_name    text,
    role            text NOT NULL DEFAULT 'user'
                        CHECK (role IN ('user', 'admin', 'mod', 'support')),
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Handle immutability: once set, can only be changed by an admin via a
-- separate migration path (not exposed to the user). The ensure_handle_allowed()
-- trigger in 0003 also fires on UPDATE OF handle, so any admin rename still
-- passes through the reserved/denied gate.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_key ON public.profiles (handle);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read any profile (public usernames).
CREATE POLICY "profiles readable by authenticated"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (true);

-- Users can only insert their own profile row (id must match auth.uid()).
-- Signup flow: Auth creates auth.users row, client then inserts profile.
CREATE POLICY "users insert own profile"
    ON public.profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (id = auth.uid());

-- Users can update their own profile (display_name, etc.). Handle changes
-- still pass through the ensure_handle_allowed() trigger; the RLS policy
-- permits the UPDATE, the trigger enforces reservation rules.
CREATE POLICY "users update own profile"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Auto-create profile row on auth.users insert. display_name defaults to
-- the email local-part; handle is set later via the handle-picker form
-- (we do NOT pick it automatically — users deserve to choose).
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, handle, display_name)
    VALUES (
        NEW.id,
        -- Placeholder handle until picker form fires. Format guarantees
        -- uniqueness via the uuid tail; ensure_handle_allowed() will
        -- accept it because it doesn't match any reserved/denied entry.
        'u' || replace(NEW.id::text, '-', ''),
        split_part(NEW.email, '@', 1)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_handle_new_user ON auth.users;
CREATE TRIGGER trg_handle_new_user
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMIT;
