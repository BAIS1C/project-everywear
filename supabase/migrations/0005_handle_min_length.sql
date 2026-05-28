-- 0005_handle_min_length.sql
--
-- Enforces the 5-character handle floor server-side. Matches the TS
-- validator in src/lib/auth/normalise_handle.ts (MIN_LEN = 5, bumped
-- from 3 on 2026-04-22 per Sean).
--
-- Two layers:
--   1. ensure_handle_allowed() trigger raises a clean exception with a
--      human-readable message, which is what the client picks up and
--      surfaces in the handle-picker form.
--   2. Table-level CHECK constraints catch anything that bypasses the
--      trigger (e.g. a future service-role path that sidesteps it).
--      Belt and braces.
--
-- Raw-handle minimum of 5 is applied AFTER the placeholder's grace: the
-- handle_new_user() trigger inserts `u + uuid-without-dashes` (33 chars),
-- so new auth.users insertions never trip the gate before the user has a
-- chance to pick a real handle.
--
-- Also catches the underscore/hyphen-padding bypass: "a_b_c" is 5 raw
-- chars but folds to "abc" (3 chars). The folded-length check below
-- rejects it so the canonical identity is never shorter than policy.
--
-- Currently zero user rows exist, so ADD CONSTRAINT cannot violate any
-- existing data. Verified via the dashboard Table Editor on
-- 2026-04-22 immediately after `supabase db push` of migrations 0001-0004.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Replace ensure_handle_allowed() with length checks inlined
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ensure_handle_allowed() RETURNS trigger AS $$
DECLARE
    folded_new  text;
    reserved    reserved_handles%ROWTYPE;
BEGIN
    -- Raw length gate — must be >= 5 chars. The placeholder handle
    -- ('u' || 32-char uuid = 33 chars) inserted by handle_new_user()
    -- passes this comfortably, so AFTER INSERT on auth.users never
    -- trips it.
    IF length(NEW.handle) < 5 THEN
        RAISE EXCEPTION 'Handle must be at least 5 characters'
            USING ERRCODE = 'check_violation';
    END IF;

    IF length(NEW.handle) > 24 THEN
        RAISE EXCEPTION 'Handle must be at most 24 characters'
            USING ERRCODE = 'check_violation';
    END IF;

    folded_new := fold_handle(NEW.handle);

    IF folded_new = '' THEN
        RAISE EXCEPTION 'Handle folds to empty string'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Folded length gate — prevents underscore/hyphen padding that
    -- produces a 3-char canonical identity out of a 5-char raw handle.
    IF length(folded_new) < 5 THEN
        RAISE EXCEPTION 'Handle canonical form must be at least 5 characters'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Hard reject on denied list.
    IF EXISTS (SELECT 1 FROM denied_handles WHERE folded = folded_new) THEN
        RAISE EXCEPTION 'Handle % is not allowed', NEW.handle
            USING ERRCODE = 'check_violation';
    END IF;

    -- Reserved list: allow if this user was assigned the reservation.
    SELECT * INTO reserved FROM reserved_handles WHERE folded = folded_new;
    IF FOUND THEN
        IF reserved.owner_user_id IS DISTINCT FROM NEW.id THEN
            RAISE EXCEPTION 'Handle % is reserved', NEW.handle
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- Store the folded form on the profile row for fast collision checks
    -- elsewhere in the app (e.g. @mentions).
    NEW.handle_folded := folded_new;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. Table-level CHECK constraints (belt-and-braces vs service-role writes
--    that might bypass the trigger in some future code path)
-- ---------------------------------------------------------------------------

-- handle length — range, not just minimum, so typos caught both ways.
ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_handle_length_check;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_handle_length_check
    CHECK (length(handle) BETWEEN 5 AND 24);

-- handle_folded length — only enforced when populated (NULL passes CHECK
-- by SQL spec). The trigger guarantees it's populated on every successful
-- insert/update, so NULL only ever exists transiently.
ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_handle_folded_length_check;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_handle_folded_length_check
    CHECK (handle_folded IS NULL OR length(handle_folded) >= 5);

COMMIT;
