-- The Family Save: cloud sync schema for Supabase (Postgres).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Every table uses row-level security: a signed-in user can only read and
-- write the records of a household they belong to.

create extension if not exists pgcrypto;

-- A family. Members join with its invite code.
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Family' check (length(name) between 1 and 60),
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_by  uuid references auth.users on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  household_id uuid not null references public.households on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists members_user on public.members (user_id);

-- Every task, transaction, bill, log, plan... is one row. "collection" is its
-- place in the app's data (e.g. "tasks", "finance.txns"); "_doc" rows hold
-- whole objects such as monthly budget assignments. Deletes are tombstones
-- (deleted = true) so other phones learn about them.
create table if not exists public.records (
  household_id uuid not null references public.households on delete cascade,
  collection   text not null check (length(collection) <= 60),
  id           text not null check (length(id) <= 120),
  data         jsonb,
  deleted      boolean not null default false,
  updated_by   uuid default auth.uid(),
  updated_at   timestamptz not null default clock_timestamp(),
  primary key (household_id, collection, id),
  check (pg_column_size(data) < 200000)
);
create index if not exists records_changes on public.records (household_id, updated_at);

-- Vector AI usage through the server proxy, per user per day (rate limit).
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null default current_date,
  count   int  not null default 0,
  primary key (user_id, day)
);

-- Server sets who/when on every write, so phones' clocks don't matter.
create or replace function public.records_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists records_stamp on public.records;
create trigger records_stamp before insert or update on public.records
  for each row execute function public.records_stamp();

create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where household_id = h and user_id = auth.uid())
$$;

alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.records    enable row level security;
alter table public.ai_usage   enable row level security;

drop policy if exists "members read household" on public.households;
create policy "members read household" on public.households
  for select to authenticated using (public.is_member(id));
drop policy if exists "owner renames household" on public.households;
create policy "owner renames household" on public.households
  for update to authenticated
  using (exists (select 1 from public.members m where m.household_id = households.id and m.user_id = auth.uid() and m.role = 'owner'));

drop policy if exists "members see each other" on public.members;
create policy "members see each other" on public.members
  for select to authenticated using (public.is_member(household_id));
drop policy if exists "leave household" on public.members;
create policy "leave household" on public.members
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "members read records" on public.records;
create policy "members read records" on public.records
  for select to authenticated using (public.is_member(household_id));
drop policy if exists "members add records" on public.records;
create policy "members add records" on public.records
  for insert to authenticated with check (public.is_member(household_id));
drop policy if exists "members change records" on public.records;
create policy "members change records" on public.records
  for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));

drop policy if exists "own usage" on public.ai_usage;
create policy "own usage" on public.ai_usage
  for select to authenticated using (user_id = auth.uid());

-- Create a family; the caller becomes its owner.
create or replace function public.create_household(p_name text default 'Family')
returns setof public.households
language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into households (name, created_by) values (coalesce(nullif(trim(p_name), ''), 'Family'), auth.uid()) returning * into h;
  insert into members (household_id, user_id, role) values (h.id, auth.uid(), 'owner');
  return next h;
end $$;

-- Join a family with its invite code.
create or replace function public.join_household(p_code text)
returns setof public.households
language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into h from households where invite_code = upper(trim(p_code));
  if h.id is null then raise exception 'That invite code was not found'; end if;
  insert into members (household_id, user_id) values (h.id, auth.uid()) on conflict do nothing;
  return next h;
end $$;

-- The caller's family (most recently joined), if any.
create or replace function public.my_household()
returns setof public.households
language sql stable security definer set search_path = public as $$
  select h.* from households h join members m on m.household_id = h.id
  where m.user_id = auth.uid() order by m.joined_at desc limit 1
$$;

-- Owner: make a new invite code (the old one stops working).
create or replace function public.new_invite_code(p_household uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare c text := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
begin
  if not exists (select 1 from members where household_id = p_household and user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the family owner can do that';
  end if;
  update households set invite_code = c where id = p_household;
  return c;
end $$;

-- Count one AI request for the caller; returns today's total.
create or replace function public.bump_ai_usage()
returns int
language sql security definer set search_path = public as $$
  insert into ai_usage (user_id, count) values (auth.uid(), 1)
  on conflict (user_id, day) do update set count = ai_usage.count + 1
  returning count
$$;

revoke all on function public.create_household(text), public.join_household(text), public.my_household(),
  public.new_invite_code(uuid), public.bump_ai_usage(), public.is_member(uuid) from public, anon;
grant execute on function public.create_household(text), public.join_household(text), public.my_household(),
  public.new_invite_code(uuid), public.bump_ai_usage(), public.is_member(uuid) to authenticated;
