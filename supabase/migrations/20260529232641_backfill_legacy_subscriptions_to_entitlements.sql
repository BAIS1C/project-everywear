-- 20260529232641_backfill_legacy_subscriptions_to_entitlements.sql
-- Location: C:\Users\MAG MSI\Project Everywear\supabase\migrations
-- Timestamp: 2026-05-29 23:26 SGT
--
-- WHY:
-- 20260528140643_everywear_identity_entitlement_vault_contract.sql repointed
-- active_tier() and entitlement_flags() at public.user_entitlements but never
-- copied existing public.subscriptions rows across. Result: user_entitlements
-- and provider_subscriptions were empty for every account, active_tier()
-- resolved 'demo' platform-wide, and all S3-family applets (gener8, 1magen,
-- 3nvizen, vid, ai_director) locked for all users including the owner.
--
-- WHAT:
-- Translate every ACTIVE legacy subscription whose tier maps to a neutral plan
-- into (1) an audit row in provider_subscriptions and (2) resolved grants in
-- user_entitlements, expanded from the seeded plan_entitlements catalog so the
-- catalog stays the single source of truth.
--
-- IDEMPOTENT:
-- provider_subscriptions guarded on metadata.legacy_subscription_id;
-- user_entitlements guarded on unique (user_id, entitlement_key, source_ref)
-- with source_ref = 'legacy_backfill:'||subscription.id.
-- Safe to re-run. demo-tier rows intentionally excluded (demo grants come free
-- via the free_everywear union in entitlement_flags()).
--
-- Sean 2026-05-29 SGT.

begin;

-- Legacy tier label -> neutral plan id. one_time plans grant permanent rows.
create temporary table _tier_plan (tier text, plan_id text, is_one_time boolean)
  on commit drop;
insert into _tier_plan (tier, plan_id, is_one_time) values
  ('creator_studio', 'creator_studio', false),
  ('gener8_pro',     'gener8_pro',     false),
  ('gener8',         'gener8_4ever',   true);

-- 1) Audit each active legacy subscription into provider_subscriptions.
insert into public.provider_subscriptions
  (user_id, provider, provider_subscription_id, plan_id, status,
   starts_at, current_period_end, metadata)
select s.user_id,
       s.provider,
       s.provider_sub_id,
       tp.plan_id,
       'active',
       coalesce(s.started_at, now()),
       s.current_period_end,
       jsonb_build_object(
         'legacy_subscription_id', s.id::text,
         'legacy_tier', s.tier,
         'backfilled_at', now()::text)
from public.subscriptions s
join _tier_plan tp on tp.tier = s.tier
where s.status = 'active'
  and not exists (
    select 1 from public.provider_subscriptions ps
    where ps.metadata->>'legacy_subscription_id' = s.id::text
  );

-- 2) Expand each active legacy subscription into resolved user_entitlements
--    rows via the seeded plan_entitlements catalog.
insert into public.user_entitlements
  (user_id, entitlement_key, entitlement_type, source_plan_id,
   source_provider, source_ref, status, is_permanent,
   starts_at, ends_at, metadata)
select s.user_id,
       pe.entitlement_key,
       pe.entitlement_type,
       tp.plan_id,
       s.provider,
       'legacy_backfill:'||s.id::text,
       'active',
       tp.is_one_time,
       coalesce(s.started_at, now()),
       case when tp.is_one_time then null else s.current_period_end end,
       jsonb_build_object('legacy_subscription_id', s.id::text,
                          'legacy_tier', s.tier)
from public.subscriptions s
join _tier_plan tp on tp.tier = s.tier
join public.plan_entitlements pe on pe.plan_id = tp.plan_id
where s.status = 'active'
on conflict (user_id, entitlement_key, source_ref) do nothing;

commit;
