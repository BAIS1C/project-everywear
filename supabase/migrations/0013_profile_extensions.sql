-- 0013_profile_extensions.sql
--
-- STATUS: DRAFT — do not `supabase db push` until reviewed.
--
-- Extends public.profiles with the columns the new ProfileCore applet
-- exposes (Identity card + Preferences card). The Subscription card
-- reads from public.subscriptions; the Usage card is placeholder UI
-- pending generation_events instrumentation in the shim.
--
-- Companion storage bucket `avatars` (public read, authed write keyed
-- by user id) must be created via the Supabase dashboard before the
-- avatar upload UI works. Storage policies are dashboard-side, not
-- in this SQL file.
--
-- Sean 2026-04-26 SGT.

BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS bio                    text,
    ADD COLUMN IF NOT EXISTS avatar_url             text,
    ADD COLUMN IF NOT EXISTS social_sharing_opt_in  boolean NOT NULL DEFAULT false;

-- Cap bio length at 1000 chars so the field stays sensible. Stored in
-- a CHECK rather than enforced at insert time so existing rows
-- (currently NULL) pass without backfill.
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_bio_length CHECK (
        bio IS NULL OR char_length(bio) <= 1000
    );

-- Avatar URL points at the public `avatars` storage bucket. We do not
-- enforce shape here because the bucket public URL might change format
-- if we ever migrate storage. Validation is client-side.

-- Owners can read + update their own profile (existing policy from
-- 0001_profiles already covers this; not redefined here).

COMMIT;
