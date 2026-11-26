-- Run once in the Supabase dashboard SQL editor as postgres.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'visitor'))
);
create table public.parking_lots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (length(trim(name)) between 1 and 100),
  address text not null check (length(trim(address)) between 1 and 240),
  description text not null default '' check (length(description) <= 1000),
  rows integer not null check (rows between 1 and 26),
  spaces_per_row integer not null check (spaces_per_row between 1 and 20),
  published boolean not null default false,
  created_at timestamptz not null default now()
);
create index parking_lots_owner on public.parking_lots(owner_id);
create table public.parking_slots (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.parking_lots(id) on delete cascade,
  label text not null,
  row_index integer not null check (row_index between 0 and 25),
  position integer not null check (position between 1 and 20),
  occupancy text not null default 'unknown' check (occupancy in ('free', 'occupied', 'unknown')),
  input_mode text not null default 'manual' check (input_mode in ('manual', 'sensor')),
  input_source text not null default 'manual_demo',
  observed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(lot_id, label),
  unique(lot_id, row_index, position),
  check (label = chr(65 + row_index) || position::text),
  check ((input_mode = 'manual' and input_source = 'manual_demo')
      or (input_mode = 'sensor' and input_source <> 'manual_demo')),
  check (occupancy = 'unknown' or observed_at is not null)
);

-- A metadata-only invalidation signal avoids leaking draft data and ensures an
-- unpublish triggers a visitor reload even when the updated lot fails its RLS.
create table public.parking_revision (
  id integer primary key check (id = 1),
  revision bigint not null default 0
);
insert into public.parking_revision(id) values (1);

alter table public.profiles enable row level security;
alter table public.parking_lots enable row level security;
alter table public.parking_slots enable row level security;
alter table public.parking_revision enable row level security;

create policy own_profile on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy visible_lots on public.parking_lots for select to authenticated
  using (published or owner_id = (select auth.uid()));
create policy visible_slots on public.parking_slots for select to authenticated
  using (exists (select 1 from public.parking_lots l where l.id = lot_id));
create policy revision_read on public.parking_revision for select to authenticated
  using (true);

create function public.create_parking_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  v_role := coalesce(new.raw_user_meta_data ->> 'role', 'visitor');
  if v_role not in ('owner', 'visitor') then
    raise exception 'Invalid account role' using errcode = '22023';
  end if;
  insert into public.profiles(id, role) values (new.id, v_role);
  return new;
end;
$$;
create trigger parking_profile_signup after insert on auth.users
  for each row execute function public.create_parking_profile();

-- Existing accounts are deliberately visitors. Mutable auth metadata is never
-- consulted for authorization after this one-time profile creation.
insert into public.profiles(id, role)
  select id, 'visitor' from auth.users on conflict(id) do nothing;

create function public.bump_parking_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.parking_revision set revision = revision + 1 where id = 1;
  return null;
end;
$$;
create trigger lots_changed after insert or update or delete on public.parking_lots
  for each statement execute function public.bump_parking_revision();
create trigger slots_changed after insert or update or delete on public.parking_slots
  for each statement execute function public.bump_parking_revision();

create function public.create_parking_lot(
  p_name text, p_address text, p_description text, p_rows integer, p_spaces integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'owner'
  ) then raise exception 'Only lot owners can create parking lots' using errcode = '42501'; end if;
  if p_rows is null or p_spaces is null or p_rows not between 1 and 26 or p_spaces not between 1 and 20 then
    raise exception 'Use 1-26 rows and 1-20 spaces per row' using errcode = '22023';
  end if;
  insert into public.parking_lots(owner_id, name, address, description, rows, spaces_per_row)
    values (auth.uid(), trim(p_name), trim(p_address), trim(p_description), p_rows, p_spaces)
    returning id into v_id;
  insert into public.parking_slots(lot_id, label, row_index, position)
    select v_id, chr(65 + r) || s::text, r, s
    from generate_series(0, p_rows - 1) r cross join generate_series(1, p_spaces) s;
  return v_id;
end;
$$;

create function public.update_parking_lot(p_id uuid, p_name text, p_address text, p_description text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.parking_lots l set name = trim(p_name), address = trim(p_address), description = trim(p_description)
    where l.id = p_id and l.owner_id = auth.uid()
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner');
  if not found then raise exception 'Lot not found or not owned by this account' using errcode = '42501'; end if;
end;
$$;

create function public.publish_parking_lot(p_id uuid, p_published boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.parking_lots l set published = p_published
    where l.id = p_id and l.owner_id = auth.uid()
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner');
  if not found then raise exception 'Lot not found or not owned by this account' using errcode = '42501'; end if;
end;
$$;

create function public.set_manual_occupancy(p_id uuid, p_occupancy text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_occupancy is null or p_occupancy not in ('free', 'occupied', 'unknown') then
    raise exception 'Invalid occupancy' using errcode = '22023';
  end if;
  update public.parking_slots s
    set occupancy = p_occupancy, input_source = 'manual_demo', observed_at = now(), updated_at = now()
    from public.parking_lots l
    where s.id = p_id and s.lot_id = l.id and s.input_mode = 'manual'
      and l.owner_id = auth.uid()
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner');
  if not found then
    raise exception 'Slot not found, not owned, or not in manual input mode' using errcode = '42501';
  end if;
end;
$$;

-- One MVCC statement gives consistent lots and slots; invoker privileges apply RLS.
create function public.parking_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'lots', coalesce((select jsonb_agg(l order by l.created_at desc) from public.parking_lots l), '[]'::jsonb),
    'slots', coalesce((select jsonb_agg(s order by s.row_index, s.position) from public.parking_slots s), '[]'::jsonb)
  );
$$;

-- Explicit least-privilege grants work with automatic table grants disabled.
grant usage on schema public to authenticated;
revoke all on public.profiles, public.parking_lots, public.parking_slots, public.parking_revision from public, anon, authenticated;
grant select on public.profiles, public.parking_lots, public.parking_slots, public.parking_revision to authenticated;
revoke all on function public.create_parking_profile() from public, anon, authenticated;
revoke all on function public.bump_parking_revision() from public, anon, authenticated;
revoke all on function public.create_parking_lot(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.update_parking_lot(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.publish_parking_lot(uuid, boolean) from public, anon, authenticated;
revoke all on function public.set_manual_occupancy(uuid, text) from public, anon, authenticated;
revoke all on function public.parking_snapshot() from public, anon, authenticated;
grant execute on function public.create_parking_lot(text, text, text, integer, integer),
  public.update_parking_lot(uuid, text, text, text), public.publish_parking_lot(uuid, boolean),
  public.set_manual_occupancy(uuid, text), public.parking_snapshot() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'parking_revision'
  ) then
    alter publication supabase_realtime add table public.parking_revision;
  end if;
end;
$$;
commit;
