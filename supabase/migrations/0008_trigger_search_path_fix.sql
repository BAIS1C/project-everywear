-- 0008_trigger_search_path_fix.sql
--
-- Root-cause bug that has been silently killing signup since 0003:
--
--   handle_new_user() (SECURITY DEFINER, fires AFTER INSERT on auth.users)
--   inserts into public.profiles, which fires BEFORE trigger
--   ensure_handle_allowed(). That function references:
--       denied_handles          (unqualified)
--       reserved_handles        (unqualified)
--       fold_handle()           (unqualified)
--       handle_substring_hit()  (unqualified, added in 0006)
--
--   Supabase Auth's session runs with a restricted search_path that does
--   NOT include public. Unqualified references fail to resolve inside
--   the trigger chain and Postgres raises:
--       ERROR: relation "reserved_handles" does not exist
--
--   The auth endpoint swallows the specific error and surfaces the generic
--   "Database error saving new user" to the client, which is what we've
--   been chasing.
--
-- Fix:
--   1. Rebuild ensure_handle_allowed() with SET search_path = public, pg_temp
--      at function level, and schema-qualify every table + function ref.
--   2. Pin search_path on the helper functions too (fold_handle,
--      _fold_confusables, _fold_leet, handle_substring_hit,
--      handle_new_user) so any future nested call from a restricted
--      session still resolves correctly.
--
-- This is standard practice for SECURITY DEFINER and trigger functions;
-- 0003 omitted it and we ate the tax until now.

BEGIN;

-- ---------------------------------------------------------------------------
-- Rebuild the gate with pinned search_path + fully qualified references
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_handle_allowed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    folded_new      text;
    reserved        public.reserved_handles%ROWTYPE;
    hit             record;
    is_placeholder  boolean;
BEGIN
    -- System-generated placeholder from handle_new_user(). Short-circuit.
    is_placeholder := (NEW.handle ~ '^u[0-9a-f]{32}$');

    IF is_placeholder THEN
        NEW.handle_folded := public.fold_handle(NEW.handle);
        RETURN NEW;
    END IF;

    -- Raw length gate.
    IF length(NEW.handle) < 5 THEN
        RAISE EXCEPTION 'Handle must be at least 5 characters'
            USING ERRCODE = 'check_violation';
    END IF;

    IF length(NEW.handle) > 24 THEN
        RAISE EXCEPTION 'Handle must be at most 24 characters'
            USING ERRCODE = 'check_violation';
    END IF;

    folded_new := public.fold_handle(NEW.handle);

    IF folded_new = '' THEN
        RAISE EXCEPTION 'Handle folds to empty string'
            USING ERRCODE = 'check_violation';
    END IF;

    IF length(folded_new) < 5 THEN
        RAISE EXCEPTION 'Handle canonical form must be at least 5 characters'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Hard reject on denied list.
    IF EXISTS (SELECT 1 FROM public.denied_handles WHERE folded = folded_new) THEN
        RAISE EXCEPTION 'Handle % is not allowed', NEW.handle
            USING ERRCODE = 'check_violation';
    END IF;

    -- Substring gate.
    SELECT * INTO hit FROM public.handle_substring_hit(folded_new);
    IF hit.needle IS NOT NULL THEN
        IF hit.category = 'brand' THEN
            RAISE EXCEPTION 'Handle % contains a protected brand name', NEW.handle
                USING ERRCODE = 'check_violation';
        ELSIF hit.category = 'authority' THEN
            RAISE EXCEPTION 'Handle % contains a protected authority term', NEW.handle
                USING ERRCODE = 'check_violation';
        ELSE
            RAISE EXCEPTION 'Handle % contains a blocked term', NEW.handle
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- Reserved list with assignment check.
    SELECT * INTO reserved FROM public.reserved_handles WHERE folded = folded_new;
    IF FOUND THEN
        IF reserved.owner_user_id IS DISTINCT FROM NEW.id THEN
            RAISE EXCEPTION 'Handle % is reserved', NEW.handle
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    NEW.handle_folded := folded_new;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Pin search_path on the helpers too — belt and braces for any future
-- nested call from a session with a restricted search_path.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.fold_handle(text)
    SET search_path = public, pg_temp;

ALTER FUNCTION public._fold_confusables(text)
    SET search_path = public, pg_temp;

ALTER FUNCTION public._fold_leet(text)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.handle_substring_hit(text)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.handle_new_user()
    SET search_path = public, pg_temp;

COMMIT;
