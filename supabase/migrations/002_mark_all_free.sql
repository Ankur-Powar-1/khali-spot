-- Run once after 001_parking.sql. Existing lots and slot identities are preserved.
begin;

create function public.mark_all_manual_free(p_lot_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.parking_lots l
    join public.profiles p on p.id = l.owner_id
    where l.id = p_lot_id and l.owner_id = auth.uid() and p.role = 'owner'
  ) then
    raise exception 'Lot not found or not owned by this account' using errcode = '42501';
  end if;

  update public.parking_slots
    set occupancy = 'free', input_source = 'manual_demo', observed_at = now(), updated_at = now()
    where lot_id = p_lot_id and input_mode = 'manual';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'This lot has no manual-input spaces to mark free' using errcode = '22023';
  end if;
  return v_count;
end;
$$;

revoke all on function public.mark_all_manual_free(uuid) from public, anon, authenticated;
grant execute on function public.mark_all_manual_free(uuid) to authenticated;

commit;
