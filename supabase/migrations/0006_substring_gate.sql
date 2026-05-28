-- 0006_substring_gate.sql
--
-- Closes the combinatorial hole in 0003's reserved/denied dictionaries.
-- The existing gate rejects exact folded-form matches: "strands" ✓ blocked,
-- "strandsceo" ✗ passes (different folded form). That's a clean vector
-- for brand impersonation — a scammer registers StrandsCEO, StrandsAirdrop,
-- StrandsSupport, and every variant we didn't explicitly list.
--
-- This migration adds a SUBSTRING gate on handle_folded, driven by a
-- small seed table (handle_substring_blocks). Three categories:
--
--   brand      — project-specific invented strings. Very low false-positive
--                risk because these aren't natural words. Rejection of
--                "Strandsberg" (Swedish surname variant) is accepted as
--                collateral; admin can assign_reserved() if it ever happens.
--
--   authority  — generic authority / trust words used in impersonation
--                ("admin", "moderator"). Wider false-positive surface:
--                "badminton" → contains "admin" → blocked. Rare enough
--                to accept.
--
--   scam       — crypto-scam vocabulary. "airdrop", "giveaway". Effectively
--                zero legitimate usage in identity handles.
--
-- Conservative starter list only. Additions land via follow-on migrations
-- so the audit trail shows every widening of the gate. No runtime admin
-- UI for this — the list is policy, not user data.

BEGIN;

-- ---------------------------------------------------------------------------
-- handle_substring_blocks table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.handle_substring_blocks (
    id          bigserial PRIMARY KEY,
    needle      text NOT NULL,
    category    text NOT NULL CHECK (category IN ('brand', 'authority', 'scam')),
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS handle_substring_blocks_needle_key
    ON public.handle_substring_blocks (needle);

ALTER TABLE public.handle_substring_blocks ENABLE ROW LEVEL SECURITY;

-- No SELECT policy — this is effectively a denylist dictionary and reading
-- it hands attackers a cheat sheet. The trigger runs as SECURITY DEFINER
-- where needed, and service-role bypasses RLS, so the gate still works.
-- No INSERT / UPDATE / DELETE policy either; only service-role can write.

-- ---------------------------------------------------------------------------
-- Seed the starter list
-- ---------------------------------------------------------------------------

INSERT INTO public.handle_substring_blocks (needle, category, note) VALUES
    -- Brand tokens: project-invented, low collision risk with natural words.
    -- Each one blocks EVERY folded handle that contains it as a substring.
    ('strands',     'brand',     'Primary brand — blocks StrandsCEO / mystrands / strands-team etc.'),
    ('metafintek',  'brand',     'Operating studio brand'),
    ('somokasane',  'brand',     'Singapore entity / personal alias'),
    ('everywear',   'brand',     'Identity namespace brand'),
    ('gener8',      'brand',     'Product brand — blocks gener8pro / mygener8 etc.'),
    ('mymory',      'brand',     'Knowledge vault brand'),

    -- Authority tokens: generic but high-value for impersonation.
    -- Note: "admin" also appears inside "badminton" etc. — accepted
    -- collateral given how heavily the pattern is abused in scam.
    ('admin',       'authority', 'Catches adminstrands / strandsadmin / theadmin'),
    ('administrator','authority','Long form'),
    ('moderator',   'authority', 'Catches moderatorsean / supportmoderator'),

    -- Scam tokens: vocabulary that has effectively zero legitimate use in
    -- an identity handle. Any appearance is a red flag.
    ('airdrop',     'scam',      'Crypto airdrop phishing'),
    ('giveaway',    'scam',      'Giveaway phishing')
ON CONFLICT (needle) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Helper: check whether a folded handle contains any blocked substring.
-- Returns the needle that matched, or NULL if clean. SECURITY DEFINER
-- so the trigger can read handle_substring_blocks regardless of the
-- caller's privileges.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_substring_hit(p_folded text)
RETURNS TABLE(needle text, category text)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT b.needle, b.category
    FROM public.handle_substring_blocks b
    WHERE p_folded LIKE '%' || b.needle || '%'
    ORDER BY length(b.needle) DESC
    LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Replace ensure_handle_allowed() with the substring gate inlined
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ensure_handle_allowed() RETURNS trigger AS $$
DECLARE
    folded_new    text;
    reserved      reserved_handles%ROWTYPE;
    hit           record;
BEGIN
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

    -- Folded length gate (from 0005): catches underscore-padding bypass.
    IF length(folded_new) < 5 THEN
        RAISE EXCEPTION 'Handle canonical form must be at least 5 characters'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Hard reject on denied list (from 0003).
    IF EXISTS (SELECT 1 FROM denied_handles WHERE folded = folded_new) THEN
        RAISE EXCEPTION 'Handle % is not allowed', NEW.handle
            USING ERRCODE = 'check_violation';
    END IF;

    -- Substring gate (NEW 0006). Skip for the placeholder handle that
    -- handle_new_user() inserts — it's a UUID-derived string with the
    -- 'u' prefix, zero impersonation risk, and we can't have the
    -- auth.users trigger fail on insert or signup breaks.
    IF NEW.handle NOT LIKE 'u%' OR length(NEW.handle) != 33 THEN
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
    END IF;

    -- Reserved list: allow if this user was assigned the reservation
    -- (from 0003). Note this runs AFTER the substring gate, so a user
    -- who's been assigned "StrandsCEO" via assign_reserved() would still
    -- be blocked at the substring check. That's intentional: substring
    -- hits are policy, reserved assignments are a convenience layer on
    -- top of an exact-match gate. If you ever need to hand someone a
    -- handle that contains a brand substring, delete the row from
    -- handle_substring_blocks first.
    SELECT * INTO reserved FROM reserved_handles WHERE folded = folded_new;
    IF FOUND THEN
        IF reserved.owner_user_id IS DISTINCT FROM NEW.id THEN
            RAISE EXCEPTION 'Handle % is reserved', NEW.handle
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- Store the folded form on the profile row for fast collision checks.
    NEW.handle_folded := folded_new;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
