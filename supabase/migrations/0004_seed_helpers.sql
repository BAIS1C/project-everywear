-- 0004_seed_helpers.sql
--
-- Bulk-insert RPCs for the one-shot seed loader (scripts/seed_handles.mjs).
-- These exist so the loader can push all reserved/denied rows in a single
-- round-trip and let Postgres apply fold_handle() server-side (no drift
-- between the loader's fold and the gate trigger's fold).
--
-- Access: EXECUTE granted to service_role only. authenticated / anon cannot
-- call these. Service-role is only ever used by the loader and Edge
-- Functions; no client code paths end up here.
--
-- Input format (jsonb array):
--   [{"display": "...", "category": "...", "note": "..."}, ...]   -- reserved
--   [{"display": "...", "reason": "...", "source": "..."}, ...]   -- denied
--
-- Both functions apply ON CONFLICT (folded) DO NOTHING so the seed load is
-- idempotent — running it twice in a row is a no-op.

BEGIN;

-- ---------------------------------------------------------------------------
-- _seed_reserved(rows jsonb): bulk insert into reserved_handles
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._seed_reserved(p_rows jsonb)
RETURNS TABLE(inserted bigint, skipped bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    r               jsonb;
    v_inserted      bigint := 0;
    v_skipped       bigint := 0;
    v_folded        text;
    v_display       text;
    v_category      text;
    v_note          text;
BEGIN
    FOR r IN SELECT jsonb_array_elements(p_rows)
    LOOP
        v_display  := r->>'display';
        v_category := r->>'category';
        v_note     := r->>'note';

        IF v_display IS NULL OR v_display = '' THEN
            CONTINUE;
        END IF;

        v_folded := fold_handle(v_display);
        IF v_folded = '' THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        INSERT INTO reserved_handles (folded, display, category, note)
        VALUES (v_folded, v_display, v_category, v_note)
        ON CONFLICT (folded) DO NOTHING;

        IF FOUND THEN
            v_inserted := v_inserted + 1;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_inserted, v_skipped;
END;
$$;

REVOKE ALL ON FUNCTION public._seed_reserved(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._seed_reserved(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- _seed_denied(rows jsonb): bulk insert into denied_handles
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._seed_denied(p_rows jsonb)
RETURNS TABLE(inserted bigint, skipped bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    r               jsonb;
    v_inserted      bigint := 0;
    v_skipped       bigint := 0;
    v_folded        text;
    v_display       text;
    v_reason        text;
    v_source        text;
BEGIN
    FOR r IN SELECT jsonb_array_elements(p_rows)
    LOOP
        v_display := r->>'display';
        v_reason  := r->>'reason';
        v_source  := r->>'source';

        IF v_display IS NULL OR v_display = '' THEN
            CONTINUE;
        END IF;

        v_folded := fold_handle(v_display);
        IF v_folded = '' THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        INSERT INTO denied_handles (folded, display, reason, source)
        VALUES (v_folded, v_display, v_reason, v_source)
        ON CONFLICT (folded) DO NOTHING;

        IF FOUND THEN
            v_inserted := v_inserted + 1;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_inserted, v_skipped;
END;
$$;

REVOKE ALL ON FUNCTION public._seed_denied(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._seed_denied(jsonb) TO service_role;

COMMIT;
