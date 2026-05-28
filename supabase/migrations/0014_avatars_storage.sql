-- 0014_avatars_storage.sql
--
-- STATUS: APPLIED via MCP 2026-04-26 SGT.
-- Project: Everywear (ykqdsihnzroglepoxwcj). This file is the on-disk
-- mirror so local migration state matches remote; running
-- `supabase db push` again is a no-op since the migration is recorded
-- in supabase_migrations.schema_migrations as version 0014.
--
-- Storage bucket + RLS policies for the ProfileCore avatar upload.
-- Bucket is public-read so the avatar URL written into
-- profiles.avatar_url renders on any client without a signed URL.
-- Writes are gated to the user's own folder, keyed by auth.uid().
--
-- File path convention: avatars/{user_id}/avatar.{ext}
-- The folder-prefix check below enforces the keying:
-- (storage.foldername(name))[1] returns the first path segment, which
-- the ProfileCore upload sets to the user_id.

-- Bucket: idempotent insert in case the dashboard already created it.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars',
    'avatars',
    true,
    2 * 1024 * 1024,
    ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- INSERT policy: authenticated users can upload to their own folder.
DROP POLICY IF EXISTS "Avatars: users insert own folder" ON storage.objects;
CREATE POLICY "Avatars: users insert own folder"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- UPDATE policy: same folder check so users can replace their avatar
-- (the ProfileCore upload uses upsert: true).
DROP POLICY IF EXISTS "Avatars: users update own folder" ON storage.objects;
CREATE POLICY "Avatars: users update own folder"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- DELETE policy: users can remove their own avatar if they want.
DROP POLICY IF EXISTS "Avatars: users delete own folder" ON storage.objects;
CREATE POLICY "Avatars: users delete own folder"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Public read is implied by the bucket.public = true flag, but make
-- it explicit at the policy layer so the URL works for unauthed
-- viewers too (e.g. a public profile page later).
DROP POLICY IF EXISTS "Avatars: public read" ON storage.objects;
CREATE POLICY "Avatars: public read"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'avatars');
