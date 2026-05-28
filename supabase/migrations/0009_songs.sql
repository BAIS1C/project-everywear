-- 0009_songs.sql
--
-- STATUS: DRAFT — do not `supabase db push` until reviewed.
--
-- User's personal song library. Each song belongs to exactly one user.
-- The audio file itself lives on that user's machine (served by the Tauri
-- shim on localhost:3001 via /audio/<filename>). This table stores the
-- metadata index so a user can see their library after a browser restart
-- or from a second tab on the same machine.
--
-- Inter-user surface (public feed, comments, likes, plays counter) is OUT
-- for ship and will arrive as a later social-update migration. The
-- `is_public` column is included now so the later migration doesn't have
-- to reshape this table; no public-read RLS policy exists yet, so
-- flipping is_public=true today is inert.

BEGIN;

CREATE TABLE IF NOT EXISTS public.songs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title               text NOT NULL,
    style               text,
    lyrics              text,
    caption             text,
    cover_url           text,
    -- Relative local path (e.g. '/audio/<id>.mp3'). getAudioUrl() in
    -- s3studio-web prepends the shim base (http://localhost:3001) at
    -- render time, so this column stays transport-agnostic.
    audio_url           text,
    duration            numeric,
    bpm                 numeric,
    key_scale           text,
    time_signature      text,
    tags                text[] NOT NULL DEFAULT '{}'::text[],
    generation_params   jsonb NOT NULL DEFAULT '{}'::jsonb,
    lrc_data            text,
    is_public           boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS songs_user_id_created_idx
    ON public.songs (user_id, created_at DESC);

ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

-- Owner-only. No public-read policy ships here; the social update adds
-- `FOR SELECT USING (is_public = true)` when that surface goes live.

CREATE POLICY "owner selects own songs"
    ON public.songs
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "owner inserts own songs"
    ON public.songs
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "owner updates own songs"
    ON public.songs
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "owner deletes own songs"
    ON public.songs
    FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- Reuse the _touch_updated_at() helper installed in 0002_subscriptions.sql.
DROP TRIGGER IF EXISTS trg_songs_touch ON public.songs;
CREATE TRIGGER trg_songs_touch
    BEFORE UPDATE ON public.songs
    FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

COMMIT;
