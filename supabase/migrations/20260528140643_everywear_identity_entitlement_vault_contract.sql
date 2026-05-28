-- Everywear neutral identity, entitlement, Steam-link, and Vault contract.
--
-- Project location: C:\Users\MAG MSI\Project Everywear
-- Donor pattern: C:\Users\MAG MSI\Project S3StudioGener8\S3 STUDIO\supabase
--
-- Canon:
--   - everywear.id is the canonical account identity.
--   - S3 Studio / Gener8 Supabase is source/pattern, not final root.
--   - Steam is a linked external identity and commerce provider.
--   - Vault rows bind to owner_user_id + vault_id. sha256 is identity,
--     dedupe, and tamper evidence, not authorization.
--   - Virgin Vault bootstrap creates schema/default folders only, never
--     Sean's Project Mymory dogfood entries.

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null,
  handle_folded text,
  display_name text,
  role text not null default 'user'
    check (role in ('user', 'admin', 'mod', 'support')),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists avatar_url text,
  add column if not exists bio text,
  add column if not exists locale text,
  add column if not exists timezone text,
  add column if not exists app_metadata jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists everywear_id text
  generated always as (lower(handle) || '@everywear.id') stored;

create unique index if not exists profiles_handle_key
  on public.profiles (handle);

create unique index if not exists profiles_handle_folded_key
  on public.profiles (handle_folded)
  where handle_folded is not null;

create unique index if not exists profiles_everywear_id_key
  on public.profiles (everywear_id);

alter table public.profiles enable row level security;

drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated"
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) is not null and id = (select auth.uid()));

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) is not null and id = (select auth.uid()))
  with check ((select auth.uid()) is not null and id = (select auth.uid()));

create or replace function public._touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
  before update on public.profiles
  for each row execute function public._touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fallback_handle text;
begin
  fallback_handle := coalesce(
    nullif(regexp_replace(lower(new.raw_user_meta_data ->> 'handle'), '[^a-z0-9_-]', '', 'g'), ''),
    'u' || replace(new.id::text, '-', '')
  );

  insert into public.profiles (id, handle, handle_folded, display_name)
  values (
    new.id,
    fallback_handle,
    fallback_handle,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1),
      fallback_handle
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Linked accounts. Steam lives here as a provider, never as root identity.
create table if not exists public.external_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in (
    'steam', 'lemon_squeezy', 'xendit', 'discord', 'google', 'github', 'wallet'
  )),
  provider_subject text not null,
  provider_username text,
  provider_email text,
  status text not null default 'linked' check (status in (
    'pending', 'linked', 'revoked_by_user', 'revoked_by_provider', 'conflicted'
  )),
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subject)
);

create index if not exists external_identities_user_idx
  on public.external_identities (user_id, provider, status);

alter table public.external_identities enable row level security;

drop policy if exists "users read own external identities" on public.external_identities;
create policy "users read own external identities"
  on public.external_identities
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users revoke own external identities" on public.external_identities;
create policy "users revoke own external identities"
  on public.external_identities
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop trigger if exists trg_external_identities_touch on public.external_identities;
create trigger trg_external_identities_touch
  before update on public.external_identities
  for each row execute function public._touch_updated_at();

-- ---------------------------------------------------------------------------
-- Entitlement catalog
-- ---------------------------------------------------------------------------

create table if not exists public.products (
  id text primary key,
  family text not null,
  name text not null,
  product_type text not null check (product_type in (
    'platform', 'applet', 'bundle', 'game', 'addon', 'capability'
  )),
  launch_policy text not null default 'visible' check (launch_policy in (
    'visible', 'bundle_included', 'platform_launched', 'deferred', 'hidden'
  )),
  is_free boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
  add column if not exists tier_floor text not null default 'free_everywear'
    check (tier_floor in (
      'free_everywear', 'gener8_4ever', 'gener8_pro', 'creator_studio',
      'mymaits_full_addon', 'platform_launched', 'deferred'
    )),
  add column if not exists runtime_class text not null default 'platform'
    check (runtime_class in (
      'platform', 'bundle', 'web_applet', 'native_applet',
      'headless_runtime', 'engine_capability', 'game', 'addon'
    )),
  add column if not exists sku_policy text not null default 'free_applet'
    check (sku_policy in (
      'root_platform', 'bundle_sku', 'bundle_included', 'free_applet',
      'hidden_runtime', 'paid_addon', 'platform_game', 'deferred'
    )),
  add column if not exists catalog_status text not null default 'planned'
    check (catalog_status in (
      'live', 'beta', 'deferred', 'planned', 'hidden', 'blocked'
    ));

create table if not exists public.plans (
  id text primary key,
  product_id text not null references public.products(id) on delete restrict,
  name text not null,
  billing_model text not null check (billing_model in (
    'free', 'one_time', 'subscription', 'addon', 'microtransaction'
  )),
  provider_hint text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null references public.plans(id) on delete cascade,
  entitlement_key text not null,
  entitlement_type text not null check (entitlement_type in (
    'product', 'applet', 'engine', 'feature', 'asset_pack', 'shard_pack'
  )),
  grant_policy text not null default 'included' check (grant_policy in (
    'included', 'usage_metered', 'microtransaction_unlocked'
  )),
  metadata jsonb not null default '{}'::jsonb,
  unique (plan_id, entitlement_key)
);

create table if not exists public.provider_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null check (provider in (
    'lemon_squeezy', 'xendit', 'steam', 'demo', 'admin_override'
  )),
  provider_customer_id text,
  provider_subscription_id text,
  provider_order_id text,
  plan_id text references public.plans(id) on delete restrict,
  status text not null check (status in (
    'pending', 'active', 'past_due', 'cancelled', 'expired', 'paused',
    'refunded', 'revoked'
  )),
  starts_at timestamptz not null default now(),
  current_period_end timestamptz,
  cancelled_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists provider_subscriptions_provider_sub_unique
  on public.provider_subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

create index if not exists provider_subscriptions_user_status_idx
  on public.provider_subscriptions (user_id, status, starts_at desc);

create table if not exists public.user_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_key text not null,
  entitlement_type text not null check (entitlement_type in (
    'product', 'applet', 'engine', 'feature', 'asset_pack', 'shard_pack'
  )),
  source_plan_id text references public.plans(id) on delete set null,
  source_provider text check (source_provider in (
    'lemon_squeezy', 'xendit', 'steam', 'demo', 'admin_override', 'system'
  )),
  source_ref text,
  status text not null default 'active' check (status in (
    'active', 'pending', 'expired', 'revoked', 'refunded'
  )),
  is_permanent boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entitlement_key, source_ref)
);

create index if not exists user_entitlements_user_active_idx
  on public.user_entitlements (user_id, entitlement_key)
  where status in ('active', 'pending');

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_fingerprint_sha256 text not null,
  label text,
  platform text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, device_fingerprint_sha256)
);

create table if not exists public.webhook_events (
  provider text not null check (provider in ('lemon_squeezy', 'xendit', 'steam')),
  webhook_id text not null,
  event_name text,
  received_at timestamptz not null default now(),
  payload_sha256 text,
  primary key (provider, webhook_id)
);

create table if not exists public.steam_link_events (
  id uuid primary key default gen_random_uuid(),
  external_identity_id uuid references public.external_identities(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'link_started', 'link_confirmed', 'license_seen', 'license_revoked',
    'refund_seen', 'user_unlinked', 'conflict_detected'
  )),
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;
alter table public.plans enable row level security;
alter table public.plan_entitlements enable row level security;
alter table public.provider_subscriptions enable row level security;
alter table public.user_entitlements enable row level security;
alter table public.devices enable row level security;
alter table public.webhook_events enable row level security;
alter table public.steam_link_events enable row level security;

drop policy if exists "catalog products readable" on public.products;
create policy "catalog products readable"
  on public.products for select to anon, authenticated using (true);
drop policy if exists "catalog plans readable" on public.plans;
create policy "catalog plans readable"
  on public.plans for select to anon, authenticated using (active);
drop policy if exists "catalog plan entitlements readable" on public.plan_entitlements;
create policy "catalog plan entitlements readable"
  on public.plan_entitlements for select to anon, authenticated using (true);

drop policy if exists "users read own provider subscriptions" on public.provider_subscriptions;
create policy "users read own provider subscriptions"
  on public.provider_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users read own entitlements" on public.user_entitlements;
create policy "users read own entitlements"
  on public.user_entitlements
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users read own devices" on public.devices;
create policy "users read own devices"
  on public.devices
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users insert own devices" on public.devices;
create policy "users insert own devices"
  on public.devices
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "users update own devices" on public.devices;
create policy "users update own devices"
  on public.devices
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "users read own steam events" on public.steam_link_events;
create policy "users read own steam events"
  on public.steam_link_events
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.products to anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.plan_entitlements to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, update on public.external_identities to authenticated;
grant select on public.provider_subscriptions to authenticated;
grant select on public.user_entitlements to authenticated;
grant select, insert, update on public.devices to authenticated;
grant select on public.steam_link_events to authenticated;

-- Product and plan seed. This is catalog metadata only, not user data.
-- Every launcher/applet/capability gets an explicit tier floor and SKU policy
-- so the S3 donor ladder cannot leak back in as the account root.
insert into public.products (
  id, family, name, product_type, launch_policy, is_free,
  tier_floor, runtime_class, sku_policy, catalog_status, metadata
)
values
  ('everywear_base', 'everywear', 'Everywear Base', 'platform', 'visible', true,
    'free_everywear', 'platform', 'root_platform', 'live',
    '{"owns":["identity","vault","library","auth","vram","launcher"]}'::jsonb),
  ('s3_gener8_family', 's3', 'S3 Studio / Gener8 Family', 'bundle', 'visible', false,
    'gener8_4ever', 'bundle', 'bundle_sku', 'beta',
    '{"production_line":true,"first_paid_line":true}'::jsonb),
  ('gener8', 's3', 'Gener8', 'applet', 'bundle_included', false,
    'gener8_4ever', 'native_applet', 'bundle_included', 'beta',
    '{"applet_id":"gener8","engines":["ace_step"],"source_app_id":"gener8"}'::jsonb),
  ('gener8_4ever', 's3', 'Gener8 4ever', 'bundle', 'visible', false,
    'gener8_4ever', 'bundle', 'bundle_sku', 'beta',
    '{"includes":["gener8","1magen"],"commerce":"one_time"}'::jsonb),
  ('gener8_pro', 's3', 'Gener8 Pro', 'bundle', 'visible', false,
    'gener8_pro', 'bundle', 'bundle_sku', 'beta',
    '{"includes":["gener8","1magen","3nvizen"],"commerce":"subscription"}'::jsonb),
  ('creator_studio', 's3', 'Creator Studio', 'bundle', 'deferred', false,
    'creator_studio', 'bundle', 'bundle_sku', 'deferred',
    '{"inherits":["gener8_pro"],"includes":["ai_director","daw_pro","vid_pro"]}'::jsonb),
  ('1magen', 'everywear', '1magen', 'applet', 'bundle_included', false,
    'gener8_4ever', 'native_applet', 'bundle_included', 'beta',
    '{"applet_id":"1magen","source_app_id":"1magen","engine":"image"}'::jsonb),
  ('3nvizen', 'everywear', '3nvizen', 'applet', 'bundle_included', false,
    'gener8_pro', 'native_applet', 'bundle_included', 'blocked',
    '{"applet_id":"3nvizen","source_app_id":"3nvizen","engine":"video","blocker":"live_sidecar_generation_unproven"}'::jsonb),
  ('vid', 's3', 'Vid Studio', 'applet', 'bundle_included', false,
    'creator_studio', 'web_applet', 'bundle_included', 'blocked',
    '{"applet_id":"vid","blocker":"video_modal_visual_parity"}'::jsonb),
  ('ai_director', 's3', 'AI Director', 'capability', 'bundle_included', false,
    'creator_studio', 'engine_capability', 'bundle_included', 'beta',
    '{"provider_route":"sapi","providers":["lm_studio","ollama","external_api"],"internal_mymaits_provider":"planned"}'::jsonb),
  ('daw_pro', 's3', 'DAW Pro', 'capability', 'bundle_included', false,
    'creator_studio', 'engine_capability', 'bundle_included', 'beta',
    '{"surface":"gener8_daw"}'::jsonb),
  ('loom', 'everywear', 'Loom', 'applet', 'visible', true,
    'free_everywear', 'web_applet', 'free_applet', 'beta',
    '{"applet_id":"loom","uses":["mymaits_lite_runtime"],"teacher_agent":true}'::jsonb),
  ('character_studio', 'everywear', 'Character Studio', 'applet', 'visible', true,
    'free_everywear', 'web_applet', 'free_applet', 'beta',
    '{"applet_id":"character-studio","exports":["strands-avatar-v1"]}'::jsonb),
  ('mymaits_lite_runtime', 'mymaits', 'My Maits Lite Runtime', 'capability', 'hidden', true,
    'free_everywear', 'headless_runtime', 'hidden_runtime', 'hidden',
    '{"not_standalone":true,"not_chat_surface":true,"consumers":["loom","ai_director_future"]}'::jsonb),
  ('mymaits_full', 'mymaits', 'My Maits', 'addon', 'visible', false,
    'mymaits_full_addon', 'addon', 'paid_addon', 'planned',
    '{"applet_id":"kasai","legacy_internal_id":"kasai","microtransactions":true}'::jsonb),
  ('mymories', 'everywear', 'Mymories', 'applet', 'deferred', true,
    'deferred', 'web_applet', 'deferred', 'planned',
    '{"applet_id":"mymories","status":"placeholder"}'::jsonb),
  ('layeru-osint', 'son', 'Layer U OSINT', 'applet', 'deferred', true,
    'deferred', 'web_applet', 'deferred', 'planned',
    '{"applet_id":"layeru-osint","status":"paused_project_son_surface"}'::jsonb),
  ('s3studio', 's3', 'S3 Studio Legacy Placeholder', 'applet', 'deferred', false,
    'deferred', 'web_applet', 'deferred', 'planned',
    '{"applet_id":"s3studio","status":"placeholder_gener8_is_active_route"}'::jsonb),
  ('strands_game', 'strands', 'Strands the Game', 'game', 'platform_launched', false,
    'platform_launched', 'game', 'platform_game', 'planned',
    '{"not_near_term_applet_port":true}'::jsonb),
  ('mymaids_game', 'strands', 'MyMaiDs / My Maids', 'game', 'platform_launched', false,
    'platform_launched', 'game', 'platform_game', 'planned',
    '{"not_near_term_applet_port":true,"naming":"needs_public_lock"}'::jsonb)
on conflict (id) do update set
  family = excluded.family,
  name = excluded.name,
  product_type = excluded.product_type,
  launch_policy = excluded.launch_policy,
  is_free = excluded.is_free,
  tier_floor = excluded.tier_floor,
  runtime_class = excluded.runtime_class,
  sku_policy = excluded.sku_policy,
  catalog_status = excluded.catalog_status,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.plans (id, product_id, name, billing_model, provider_hint)
values
  ('free_everywear', 'everywear_base', 'Free Everywear', 'free', 'system'),
  ('gener8_4ever', 'gener8_4ever', 'Gener8 4ever', 'one_time', 'lemon_squeezy'),
  ('gener8_pro', 'gener8_pro', 'Gener8 Pro', 'subscription', 'lemon_squeezy'),
  ('creator_studio', 'creator_studio', 'Creator Studio', 'subscription', 'lemon_squeezy'),
  ('mymaits_full_addon', 'mymaits_full', 'My Maits', 'addon', 'steam')
on conflict (id) do update set
  product_id = excluded.product_id,
  name = excluded.name,
  billing_model = excluded.billing_model,
  provider_hint = excluded.provider_hint,
  updated_at = now();

insert into public.plan_entitlements (plan_id, entitlement_key, entitlement_type, grant_policy)
values
  ('free_everywear', 'everywear_base', 'product', 'included'),
  ('free_everywear', 'loom', 'applet', 'included'),
  ('free_everywear', 'loom.teacher_agent', 'feature', 'included'),
  ('free_everywear', 'character_studio', 'applet', 'included'),
  ('free_everywear', 'mymaits_lite_runtime', 'engine', 'included'),
  ('gener8_4ever', 'gener8', 'applet', 'included'),
  ('gener8_4ever', 'gener8.audio', 'engine', 'included'),
  ('gener8_4ever', '1magen', 'applet', 'included'),
  ('gener8_4ever', '1magen.image', 'engine', 'included'),
  ('gener8_pro', 'gener8', 'applet', 'included'),
  ('gener8_pro', 'gener8.audio', 'engine', 'included'),
  ('gener8_pro', 'gener8.pro_model_pack', 'asset_pack', 'included'),
  ('gener8_pro', '1magen', 'applet', 'included'),
  ('gener8_pro', '1magen.image', 'engine', 'included'),
  ('gener8_pro', '3nvizen', 'applet', 'included'),
  ('gener8_pro', '3nvizen.video', 'engine', 'included'),
  ('creator_studio', 'gener8', 'applet', 'included'),
  ('creator_studio', 'gener8.audio', 'engine', 'included'),
  ('creator_studio', 'gener8.pro_model_pack', 'asset_pack', 'included'),
  ('creator_studio', '1magen', 'applet', 'included'),
  ('creator_studio', '1magen.image', 'engine', 'included'),
  ('creator_studio', '3nvizen', 'applet', 'included'),
  ('creator_studio', '3nvizen.video', 'engine', 'included'),
  ('creator_studio', 'ai_director', 'feature', 'included'),
  ('creator_studio', 'ai_director.planner', 'feature', 'included'),
  ('creator_studio', 'daw_pro', 'feature', 'included'),
  ('creator_studio', 'vid', 'applet', 'included'),
  ('creator_studio', 'vid_pro', 'feature', 'included'),
  ('mymaits_full_addon', 'mymaits_full', 'applet', 'included'),
  ('mymaits_full_addon', 'mymaits.microtransactions', 'feature', 'microtransaction_unlocked')
on conflict (plan_id, entitlement_key) do update set
  entitlement_type = excluded.entitlement_type,
  grant_policy = excluded.grant_policy;

-- Compatibility RPC for the existing shell/frontend while neutral
-- entitlement flags are wired. Security invoker plus RLS means a user can
-- only resolve their own rows.
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
        and entitlement_key in ('creator_studio', 'ai_director', 'ai_director.planner', 'daw_pro', 'vid_pro')
        and (ends_at is null or ends_at > now())
    ) then 'creator_studio'
    when exists (
      select 1 from public.user_entitlements
      where user_id = p_user
        and status = 'active'
        and entitlement_key in ('gener8_pro', '3nvizen', '3nvizen.video', 'gener8.pro_model_pack')
        and (ends_at is null or ends_at > now())
    ) then 'gener8_pro'
    when exists (
      select 1 from public.user_entitlements
      where user_id = p_user
        and status = 'active'
        and entitlement_key in ('gener8', 'gener8.audio', '1magen', '1magen.image')
        and (ends_at is null or ends_at > now())
    ) then 'gener8'
    else 'demo'
  end;
$$;

create or replace function public.entitlement_flags(p_user uuid default auth.uid())
returns jsonb
language sql
stable
as $$
  with grants as (
    select entitlement_key
    from public.plan_entitlements
    where plan_id = 'free_everywear'
    union
    select entitlement_key
    from public.user_entitlements
    where user_id = p_user
      and p_user = (select auth.uid())
      and status = 'active'
      and (ends_at is null or ends_at > now())
  )
  select case
    when p_user is distinct from (select auth.uid()) then '{}'::jsonb
    else coalesce(jsonb_object_agg(entitlement_key, true), '{}'::jsonb)
  end
  from grants;
$$;

grant execute on function public.active_tier(uuid) to authenticated;
grant execute on function public.entitlement_flags(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Vault bootstrap and owner-bound records
-- ---------------------------------------------------------------------------

create table if not exists public.vaults (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  vault_key text not null,
  display_name text not null default 'Everywear Vault',
  schema_version text not null default 'mymory-compatible-v1',
  bootstrap_source text not null default 'project_mymory_schema_only'
    check (bootstrap_source in ('project_mymory_schema_only', 'user_import', 'system')),
  local_root_hint text,
  status text not null default 'active' check (status in ('active', 'archived', 'revoked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, vault_key)
);

create table if not exists public.vault_records (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  vault_id uuid not null references public.vaults(id) on delete cascade,
  source_app_id text not null,
  asset_kind text not null,
  media_type text not null check (media_type in (
    'image', 'audio', 'video', 'document', 'conversation', 'log',
    'context', 'shard', 'patch', 'other'
  )),
  title text not null,
  storage_mode text not null check (storage_mode in (
    'linked_original', 'symlink', 'junction', 'vault_copy', 'vault_move', 'remote_reference'
  )),
  original_path text,
  vault_path text,
  sha256 text,
  mime_type text,
  file_size_bytes bigint,
  acl_scope text not null default 'owner' check (acl_scope in (
    'owner', 'household', 'team', 'public_sample'
  )),
  provenance jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$')
);

create index if not exists vault_records_owner_vault_idx
  on public.vault_records (owner_user_id, vault_id, created_at desc);

create index if not exists vault_records_asset_kind_idx
  on public.vault_records (vault_id, asset_kind, created_at desc);

create unique index if not exists vault_records_sha256_dedupe_idx
  on public.vault_records (vault_id, sha256)
  where sha256 is not null and deleted_at is null;

create table if not exists public.vault_acl (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults(id) on delete cascade,
  record_id uuid references public.vault_records(id) on delete cascade,
  grantee_user_id uuid references auth.users(id) on delete cascade,
  scope text not null check (scope in ('read', 'write', 'admin')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.vaults enable row level security;
alter table public.vault_records enable row level security;
alter table public.vault_acl enable row level security;

drop policy if exists "users read own vaults" on public.vaults;
create policy "users read own vaults"
  on public.vaults for select to authenticated
  using (owner_user_id = (select auth.uid()));

drop policy if exists "users insert own vaults" on public.vaults;
create policy "users insert own vaults"
  on public.vaults for insert to authenticated
  with check (owner_user_id = (select auth.uid()));

drop policy if exists "users update own vaults" on public.vaults;
create policy "users update own vaults"
  on public.vaults for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

drop policy if exists "users read own vault records" on public.vault_records;
create policy "users read own vault records"
  on public.vault_records for select to authenticated
  using (owner_user_id = (select auth.uid()));

drop policy if exists "users insert own vault records" on public.vault_records;
create policy "users insert own vault records"
  on public.vault_records for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.vaults v
      where v.id = vault_id
        and v.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists "users update own vault records" on public.vault_records;
create policy "users update own vault records"
  on public.vault_records for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (
    owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.vaults v
      where v.id = vault_id
        and v.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists "users read own vault acl" on public.vault_acl;
create policy "users read own vault acl"
  on public.vault_acl for select to authenticated
  using (
    grantee_user_id = (select auth.uid())
    or granted_by = (select auth.uid())
    or exists (
      select 1 from public.vaults v
      where v.id = vault_id
        and v.owner_user_id = (select auth.uid())
    )
  );

grant select, insert, update on public.vaults to authenticated;
grant select, insert, update on public.vault_records to authenticated;
grant select on public.vault_acl to authenticated;

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
  for each row execute function public._touch_updated_at();
drop trigger if exists trg_plans_touch on public.plans;
create trigger trg_plans_touch before update on public.plans
  for each row execute function public._touch_updated_at();
drop trigger if exists trg_provider_subscriptions_touch on public.provider_subscriptions;
create trigger trg_provider_subscriptions_touch before update on public.provider_subscriptions
  for each row execute function public._touch_updated_at();
drop trigger if exists trg_user_entitlements_touch on public.user_entitlements;
create trigger trg_user_entitlements_touch before update on public.user_entitlements
  for each row execute function public._touch_updated_at();
drop trigger if exists trg_vaults_touch on public.vaults;
create trigger trg_vaults_touch before update on public.vaults
  for each row execute function public._touch_updated_at();
drop trigger if exists trg_vault_records_touch on public.vault_records;
create trigger trg_vault_records_touch before update on public.vault_records
  for each row execute function public._touch_updated_at();

commit;
