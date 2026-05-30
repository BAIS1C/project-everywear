-- 20260530175000_correct_vid_tier_contract.sql
-- Corrects the Vid Studio tier contract after the Gener8 split.
--
-- Canon:
-- - `vid` is the single Vid Studio launcher applet and is included with Gener8 4ever.
-- - `vid_pro` is an internal Vid Studio feature entitlement unlocked at Gener8 Pro.
-- - Creator Studio inherits all lower-tier Gener8 Pro capabilities, but does not define
--   Vid Pro as a Creator-only capability.
-- - 3nvizen belongs to Creator Studio, not Gener8 Pro.

update public.products
set tier_floor = 'gener8_4ever',
    metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{tier_contract}',
      '"basic_vid_at_gener8_4ever_vid_pro_at_gener8_pro"',
      true
    )
where id = 'vid';

update public.products
set metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{includes}',
      '["gener8","1magen","vid"]'::jsonb,
      true
    )
where id = 'gener8_4ever';

update public.products
set metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{includes}',
      '["gener8","1magen","vid","vid_pro"]'::jsonb,
      true
    )
where id = 'gener8_pro';

update public.products
set metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{includes}',
      '["ai_director","daw_pro","3nvizen"]'::jsonb,
      true
    )
where id = 'creator_studio';

delete from public.plan_entitlements
where plan_id = 'gener8_pro'
  and entitlement_key in ('3nvizen', '3nvizen.video');

insert into public.plan_entitlements (plan_id, entitlement_key, entitlement_type, grant_policy)
values
  ('gener8_4ever', 'vid', 'applet', 'included'),
  ('gener8_pro', 'vid', 'applet', 'included'),
  ('gener8_pro', 'vid_pro', 'feature', 'included'),
  ('creator_studio', 'vid', 'applet', 'included'),
  ('creator_studio', 'vid_pro', 'feature', 'included')
on conflict (plan_id, entitlement_key) do update set
  entitlement_type = excluded.entitlement_type,
  grant_policy = excluded.grant_policy;

create or replace function public.active_tier(p_user uuid)
returns text
language sql
stable
as $$
  select case
    when p_user is distinct from (select auth.uid()) then null
    when exists (
      select 1 from public.user_entitlements
      where user_id = p_user
        and status = 'active'
        and entitlement_key in ('creator_studio', 'ai_director', 'ai_director.planner', 'daw_pro', '3nvizen', '3nvizen.video')
        and (ends_at is null or ends_at > now())
    ) then 'creator_studio'
    when exists (
      select 1 from public.user_entitlements
      where user_id = p_user
        and status = 'active'
        and entitlement_key in ('gener8_pro', 'gener8.pro_model_pack', 'vid_pro')
        and (ends_at is null or ends_at > now())
    ) then 'gener8_pro'
    when exists (
      select 1 from public.user_entitlements
      where user_id = p_user
        and status = 'active'
        and entitlement_key in ('gener8', 'gener8.audio', '1magen', '1magen.image', 'vid')
        and (ends_at is null or ends_at > now())
    ) then 'gener8'
    else 'demo'
  end;
$$;

grant execute on function public.active_tier(uuid) to authenticated;
