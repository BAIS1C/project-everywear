-- 0007_placeholder_handle_fix.sql
--
-- Bug fix: 0005 introduced a 24-char max on handle, and the table-level
-- CHECK constraint rejects anything outside [5, 24]. But handle_new_user()
-- (from 0001) inserts a placeholder of form 'u' + 32 hex chars = 33 chars,
-- which violates the constraint. Every signup tries to write an auth.users
-- row, the AFTER INSERT trigger fires, the profile INSERT hits the CHECK
-- and RAISE, the whole transaction rolls back, and the client sees
-- "Database error saving new user". Signup is dead on arrival.
--
-- Two-part fix:
--   1. Relax the table-level CHECK to also accept the placeholder pattern.
--   2. Rewrite ensure_handle_allowed() to short-circuit the entire gate
--      for rows matching the placeholder pattern (it's a system-generated
--      string with zero impersonation risk and guaranteed uniqueness via
--      the UUID tail). This is cleaner than scattering placeholder skips
--      through each individual check.
--
-- The placeholder pattern: ^u[0-9a-f]{32}$ — the handle_new_user() trigger
-- in 0001 produces exactly this shape by concatenating 'u' with the
-- user's UUID stripped of dashes.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Relax the length CHECK to allow the placeholder
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_handle_length_check;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_handle_length_check
    CHECK (
        length(handle) BETWEEN 5 AND 24
        OR handle ~ '^u[0-9a-f]{32}$'
    );

-- ---------------------------------------------------------------------------
-- 2. Rebuild ensure_handle_allowed() with a placeholder short-circuit
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ensure_handle_allowed() RETURNS trigger AS $$
DECLARE
    folded_new      text;
    reserved        reserved_handles%ROWTYPE;
    hit             record;
    is_placeholder  boolean;
BEGIN
    -- Detect the system-generated placeholder. Short-circuit the entire
    -- gate: fold and store, then return. The placeholder can only land
    -- here via handle_new_user() on signup; a user cannot craft this
    -- pattern themselves because:
    --   - it must match ^u[0-9a-f]{32}$ exactly (33 chars)
    --   - the raw charset check in the TS validator rejects anything
    --     over 24 chars before it even reaches the server
    --   - service-role writes bypass RLS but are internal-only
    is_placeholder := (NEW.handle ~ '^u[0-9a-f]{32}$');

    IF is_placeholder THEN
        NEW.handle_folded := fold_handle(NEW.handle);
        RETURN NEW;
    END IF;

    -- Raw length gate (from 0005).
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

    -- Folded length gate (from 0005).
    IF length(folded_new) < 5 THEN
        RAISE EXCEPTION 'Handle canonical form must be at least 5 characters'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Hard reject on denied list (from 0003).
    IF EXISTS (SELECT 1 FROM denied_handles WHERE folded = folded_new) THEN
        RAISE EXCEPTION 'Handle % is not allowed', NEW.handle
            USING ERRCODE = 'check_violation';
    END IF;

    -- Substring gate (from 0006).
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

    -- Reserved list (from 0003).
    SELECT * INTO reserved FROM reserved_handles WHERE folded = folded_new;
    IF FOUND THEN
        IF reserved.owner_user_id IS DISTINCT FROM NEW.id THEN
            RAISE EXCEPTION 'Handle % is reserved', NEW.handle
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    NEW.handle_folded := folded_new;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
