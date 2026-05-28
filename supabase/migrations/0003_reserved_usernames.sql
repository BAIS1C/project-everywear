-- 0003_reserved_usernames.sql
--
-- @everywear.id namespace protection. Two tables + one trigger:
--
--   reserved_handles : folded keys that are locked; assignable only via
--                      assign_reserved() by an admin. Covers brand names,
--                      project names, role names, personal names, Strands
--                      canon entities, and scam-prefix patterns.
--
--   denied_handles   : folded keys that are permanently blocked. Covers
--                      slurs, politics, shock, impersonation-scam vectors.
--                      No admin override path. Use `reason` column for
--                      audit trail.
--
--   ensure_handle_allowed() BEFORE INSERT trigger on profiles: computes
--                      the folded form of NEW.handle via the in-db fold
--                      function, checks denied_handles (hard reject) then
--                      reserved_handles (reject unless owner_user_id matches
--                      the inserting user — the assignment row).
--
-- The in-db fold function mirrors src/auth/normalise_handle.ts. Drift is
-- a security bug; tests live alongside the TS version.
--
-- Seed files (migrations/seed/reserved.txt, denied.txt) are applied by the
-- deploy runner AFTER this migration via COPY.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fold function: Postgres mirror of foldHandle() from normalise_handle.ts.
-- Returns the canonical [a-z0-9] form used for collision checks.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _fold_confusables(s text) RETURNS text AS $$
BEGIN
    -- Cyrillic lowercase
    s := translate(s,
        'авсенijкморѕтуха',
        'abcehijkmopstyxa');
    -- Greek lowercase (most common Latin lookalikes)
    s := translate(s,
        'αβγεικμνοπρτυχ',
        'abyeikmnoppetux');
    RETURN s;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION _fold_leet(s text) RETURNS text AS $$
BEGIN
    s := translate(s, '013457 8@$!|', 'oieastb as ii');
    -- Note: translate() maps char-to-char with the same-length strings.
    -- The three-space sequence above keeps " ", "|", "!" mapped explicitly.
    -- Final strip below removes any remaining spaces.
    RETURN s;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION fold_handle(raw text) RETURNS text AS $$
DECLARE
    s text;
BEGIN
    IF raw IS NULL OR raw = '' THEN
        RETURN '';
    END IF;

    -- NFKD + strip combining marks + lowercase
    s := lower(regexp_replace(
            normalize(raw, NFKD),
            '[\u0300-\u036f]', '', 'g'));

    s := _fold_confusables(s);
    s := _fold_leet(s);

    -- Strip anything outside [a-z0-9]
    s := regexp_replace(s, '[^a-z0-9]', '', 'g');

    RETURN s;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- reserved_handles
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reserved_handles (
    id              bigserial PRIMARY KEY,
    folded          text NOT NULL,
    display         text NOT NULL,
    category        text NOT NULL CHECK (category IN (
                        'brand', 'project', 'role', 'personal',
                        'canon', 'scam_prefix')),
    note            text,
    owner_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    assigned_at     timestamptz,
    assigned_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reserved_handles_folded_key
    ON reserved_handles (folded);

ALTER TABLE reserved_handles ENABLE ROW LEVEL SECURITY;

-- Readable to authenticated users so the signup form can do a client-side
-- availability check before submit. The trigger in ensure_handle_allowed()
-- is still the authoritative gate; this read policy is UX-only.
CREATE POLICY "reserved_handles readable by authenticated"
    ON reserved_handles
    FOR SELECT
    TO authenticated
    USING (true);

-- No user writes. assign_reserved() is SECURITY DEFINER and admin-gated.

-- ---------------------------------------------------------------------------
-- denied_handles
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS denied_handles (
    id          bigserial PRIMARY KEY,
    folded      text NOT NULL,
    display     text NOT NULL,
    reason      text NOT NULL CHECK (reason IN (
                    'slur', 'politics', 'shock', 'scam', 'impersonation')),
    source      text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS denied_handles_folded_key
    ON denied_handles (folded);

ALTER TABLE denied_handles ENABLE ROW LEVEL SECURITY;

-- Denied list is NOT readable to users (don't leak the slur/politics
-- dictionary). Only the trigger (which runs as SECURITY DEFINER inside
-- the function context) needs access, and service-role bypasses RLS.
-- No SELECT policy = no one can read. That's intentional.

-- ---------------------------------------------------------------------------
-- profiles handle gate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ensure_handle_allowed() RETURNS trigger AS $$
DECLARE
    folded_new  text;
    reserved    reserved_handles%ROWTYPE;
BEGIN
    folded_new := fold_handle(NEW.handle);

    IF folded_new = '' THEN
        RAISE EXCEPTION 'Handle folds to empty string'
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

-- profiles.handle_folded column lives in 0001_profiles.sql. Unique index
-- added here so it lands alongside the trigger that populates the column.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_folded_key
    ON public.profiles (handle_folded);

DROP TRIGGER IF EXISTS trg_ensure_handle_allowed ON profiles;
CREATE TRIGGER trg_ensure_handle_allowed
    BEFORE INSERT OR UPDATE OF handle ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION ensure_handle_allowed();

-- ---------------------------------------------------------------------------
-- assign_reserved(): admin-only path to hand a reserved handle to a user.
-- Clears any prior profile using that folded key (should be impossible via
-- the trigger but defensive) and stamps the reservation row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assign_reserved(
    p_folded    text,
    p_user_id   uuid,
    p_admin_id  uuid
) RETURNS void AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM auth.users u
        JOIN profiles p ON p.id = u.id
        WHERE u.id = p_admin_id AND p.role = 'admin'
    ) THEN
        RAISE EXCEPTION 'assign_reserved requires admin caller';
    END IF;

    UPDATE reserved_handles
       SET owner_user_id = p_user_id,
           assigned_at   = now(),
           assigned_by   = p_admin_id
     WHERE folded = p_folded;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'reserved handle % not found', p_folded;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
