-- 0015_admin_override_provider.sql
--
-- Adds 'admin_override' to the subscriptions.provider CHECK constraint
-- so service-role inserts can flag accounts at any tier without going
-- through Lemon Squeezy or Xendit.
--
-- Why: Sean's main email needs creator_studio for testing the Pro/Studio
-- feature paths end-to-end. Three test accounts at demo / gener8 /
-- gener8_pro round out the test matrix. None of these are real LS
-- purchases. The webhook event dispatcher (task #25) is still pending,
-- and the launcher's tier_reconciler shouldn't care WHICH provider
-- granted the tier — only that it's active.
--
-- Ship-blocking: nothing. Backwards-compatible — existing rows pass
-- the new CHECK because their provider is one of the original three.
--
-- Rollback: DROP + re-create the constraint without 'admin_override'.
-- Existing override rows would then need to be deleted or migrated to
-- a different provider value before the rollback applies.
--
-- Sean 2026-05-02 SGT.

BEGIN;

-- Drop the old constraint by name (it's the implicit name from 0002).
-- pg_constraint stores it as <table>_<col>_check; verify before dropping.
ALTER TABLE public.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_provider_check;

ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_provider_check
    CHECK (provider IN ('lemon_squeezy', 'xendit', 'demo', 'admin_override'));

COMMIT;
