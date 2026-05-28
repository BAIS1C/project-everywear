-- 0010_playlists.sql
--
-- STATUS: DRAFT — do not `supabase db push` until reviewed.
--
-- User's personal playlists built from their own songs. Each playlist row
-- belongs to one user; junction rows link a playlist to a song THAT THE
-- SAME USER OWNS. Cross-user membership (collab playlists, following
-- someone else's playlist) is out for ship and lands with the social
-- update. Same `is_public` forward-compatibility pattern as 0009_songs.

BEGIN;

CREATE TABLE IF NOT EXISTS public.playlists (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            text NOT NULL,
    description     text,
    cover_url       text,
    is_public       boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS playlists_user_id_idx
    ON public.playlists (user_id, created_at DESC);

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner selects own playlists"
    ON public.playlists
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "owner inserts own playlists"
    ON public.playlists
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "owner updates own playlists"
    ON public.playlists
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "owner deletes own playlists"
    ON public.playlists
    FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_playlists_touch ON public.playlists;
CREATE TRIGGER trg_playlists_touch
    BEFORE UPDATE ON public.playlists
    FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- ─── playlist_songs junction ────────────────────────────────────────
-- Composite PK prevents dupe membership. `position` is client-managed;
-- no DB constraint on gaps because reordering rewrites values rather
-- than shifting rows, so uniqueness isn't preserved by design.

CREATE TABLE IF NOT EXISTS public.playlist_songs (
    playlist_id     uuid NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    song_id         uuid NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
    position        integer NOT NULL DEFAULT 0,
    added_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (playlist_id, song_id)
);

CREATE INDEX IF NOT EXISTS playlist_songs_playlist_idx
    ON public.playlist_songs (playlist_id, position);

ALTER TABLE public.playlist_songs ENABLE ROW LEVEL SECURITY;

-- Membership is only touchable when the authenticated user owns BOTH
-- the playlist AND the song being linked. Enforced via EXISTS checks
-- because RLS has no cross-table shortcut. This prevents, e.g., putting
-- someone else's song into your playlist by crafting an INSERT.

CREATE POLICY "owner selects own membership"
    ON public.playlist_songs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.playlists p
            WHERE p.id = playlist_id
              AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "owner inserts own membership"
    ON public.playlist_songs
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.playlists p
            WHERE p.id = playlist_id
              AND p.user_id = auth.uid()
        )
        AND EXISTS (
            SELECT 1 FROM public.songs s
            WHERE s.id = song_id
              AND s.user_id = auth.uid()
        )
    );

CREATE POLICY "owner updates own membership"
    ON public.playlist_songs
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.playlists p
            WHERE p.id = playlist_id
              AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.playlists p
            WHERE p.id = playlist_id
              AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "owner deletes own membership"
    ON public.playlist_songs
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.playlists p
            WHERE p.id = playlist_id
              AND p.user_id = auth.uid()
        )
    );

COMMIT;
