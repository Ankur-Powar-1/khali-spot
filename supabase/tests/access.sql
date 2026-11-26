-- Dashboard regression test: run as postgres after migration; all data rolls back.
begin;
insert into auth.users(id, email, raw_user_meta_data)
values
  ('f0100000-0000-4000-8000-000000000001', 'khali-test-owner@example.invalid', '{"role":"owner"}'),
  ('f0100000-0000-4000-8000-000000000002', 'khali-test-visitor@example.invalid', '{"role":"visitor"}'),
  ('f0100000-0000-4000-8000-000000000003', 'khali-test-other@example.invalid', '{"role":"owner"}');

do $$
begin
  begin
    insert into auth.users(id, email, raw_user_meta_data)
      values ('f0100000-0000-4000-8000-000000000004', 'khali-test-invalid@example.invalid', '{"role":"admin"}');
    raise exception 'FAIL: invalid signup role accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0100000-0000-4000-8000-000000000001', true);
select set_config('parking.test_lot',
  public.create_parking_lot('Library', 'North gate', 'Test lot', 2, 5)::text, true);

do $$
declare v_id uuid := current_setting('parking.test_lot')::uuid; v_slot uuid; v_revision bigint;
begin
  if (select count(*) from public.parking_slots where lot_id = v_id) <> 10 then raise exception 'FAIL: incorrect slot count'; end if;
  if (select array_agg(label order by row_index, position) from public.parking_slots where lot_id = v_id)
    <> array['A1','A2','A3','A4','A5','B1','B2','B3','B4','B5'] then raise exception 'FAIL: incorrect labels'; end if;
  if exists (select 1 from public.parking_slots where lot_id = v_id and (occupancy <> 'unknown' or observed_at is not null))
    then raise exception 'FAIL: new slots are not unknown'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'FAIL: other profiles visible'; end if;
  begin
    perform public.create_parking_lot('Bad', 'Gate', '', 27, 5);
    raise exception 'FAIL: invalid dimensions accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_parking_lot(' ', 'Gate', '', 1, 1);
    raise exception 'FAIL: blank lot accepted';
  exception when check_violation then null; end;
  begin
    update public.profiles set role = 'visitor';
    raise exception 'FAIL: profile mutation allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.parking_lots(owner_id, name, address, rows, spaces_per_row)
      values (auth.uid(), 'Bypass', 'Gate', 1, 1);
    raise exception 'FAIL: direct table insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.parking_slots set input_mode = 'sensor', input_source = 'test_sensor';
    raise exception 'FAIL: client input-mode change allowed';
  exception when insufficient_privilege then null; end;
  select id into v_slot from public.parking_slots where lot_id = v_id and label = 'A1';
  select revision into v_revision from public.parking_revision;
  perform public.set_manual_occupancy(v_slot, 'free');
  if not exists (select 1 from public.parking_slots where id = v_slot and occupancy = 'free' and observed_at is not null and input_source = 'manual_demo')
    then raise exception 'FAIL: manual write not persisted'; end if;
  if (select revision from public.parking_revision) <= v_revision then raise exception 'FAIL: write emitted no invalidation'; end if;
  begin
    perform public.set_manual_occupancy(v_slot, 'invalid');
    raise exception 'FAIL: invalid occupancy accepted';
  exception when invalid_parameter_value then null; end;
  perform public.update_parking_lot(v_id, 'Updated library', 'North gate', 'Updated');
  if not exists (select 1 from public.parking_slots where id = v_slot and label = 'A1')
    then raise exception 'FAIL: detail edit rebuilt slot identity'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', 'f0100000-0000-4000-8000-000000000002', true);
do $$
declare v_id uuid := current_setting('parking.test_lot')::uuid;
begin
  if exists (select 1 from public.parking_lots where id = v_id) then raise exception 'FAIL: visitor sees draft'; end if;
  if exists (select 1 from public.parking_slots where lot_id = v_id) then raise exception 'FAIL: visitor sees draft slots'; end if;
  begin
    perform public.create_parking_lot('Visitor lot', 'Gate', '', 1, 1);
    raise exception 'FAIL: visitor created lot';
  exception when insufficient_privilege then null; end;
  begin
    perform public.publish_parking_lot(v_id, true);
    raise exception 'FAIL: visitor published lot';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mark_all_manual_free(v_id);
    raise exception 'FAIL: visitor bulk-marked lot';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claim.sub', 'f0100000-0000-4000-8000-000000000001', true);
select public.publish_parking_lot(current_setting('parking.test_lot')::uuid, true);
select set_config('request.jwt.claim.sub', 'f0100000-0000-4000-8000-000000000002', true);
do $$
declare v_id uuid := current_setting('parking.test_lot')::uuid; v_slot uuid; v_data jsonb;
begin
  v_data := public.parking_snapshot();
  if not exists (select 1 from public.parking_lots where id = v_id) then raise exception 'FAIL: visitor cannot see published lot'; end if;
  if (select count(*) from public.parking_slots where lot_id = v_id) <> 10 then raise exception 'FAIL: visitor cannot see published slots'; end if;
  if not exists (select 1 from jsonb_array_elements(v_data->'lots') l where l->>'id' = v_id::text)
    then raise exception 'FAIL: snapshot omits published lot'; end if;
  select id into v_slot from public.parking_slots where lot_id = v_id and label = 'A1';
  begin
    perform public.set_manual_occupancy(v_slot, 'occupied');
    raise exception 'FAIL: visitor marked occupancy';
  exception when insufficient_privilege then null; end;
  begin
    perform public.update_parking_lot(v_id, 'Hijacked', 'Gate', '');
    raise exception 'FAIL: visitor updated details';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claim.sub', 'f0100000-0000-4000-8000-000000000003', true);
do $$
declare v_id uuid := current_setting('parking.test_lot')::uuid; v_slot uuid;
begin
  select id into v_slot from public.parking_slots where lot_id = v_id and label = 'A1';
  begin
    perform public.set_manual_occupancy(v_slot, 'occupied');
    raise exception 'FAIL: other owner marked occupancy';
  exception when insufficient_privilege then null; end;
  begin
    perform public.publish_parking_lot(v_id, false);
    raise exception 'FAIL: other owner unpublished lot';
  exception when insufficient_privilege then null; end;
  begin
    perform public.update_parking_lot(v_id, 'Hijacked', 'Gate', '');
    raise exception 'FAIL: other owner updated details';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mark_all_manual_free(v_id);
    raise exception 'FAIL: other owner bulk-marked lot';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
-- Simulate an authenticated user changing their mutable Auth metadata.
update auth.users set raw_user_meta_data = '{"role":"owner"}'
  where id = 'f0100000-0000-4000-8000-000000000002';
-- Future server-controlled sensor mode; no such writer exists in the app.
update public.parking_slots set input_mode = 'sensor', input_source = 'test_sensor', occupancy = 'unknown', observed_at = null
  where lot_id = current_setting('parking.test_lot')::uuid and label = 'A1';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0100000-0000-4000-8000-000000000002', true);
do $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'visitor'
    then raise exception 'FAIL: mutable metadata escalated role'; end if;
  begin
    perform public.create_parking_lot('Escalated', 'Gate', '', 1, 1);
    raise exception 'FAIL: metadata escalated lot creation';
  exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claim.sub', 'f0100000-0000-4000-8000-000000000001', true);
do $$
declare v_slot uuid; v_revision bigint; v_count integer; v_other uuid;
begin
  select id into v_slot from public.parking_slots where lot_id = current_setting('parking.test_lot')::uuid and label = 'A1';
  begin
    perform public.set_manual_occupancy(v_slot, 'free');
    raise exception 'FAIL: manual write competes with sensor mode';
  exception when insufficient_privilege then null; end;
  v_other := public.create_parking_lot('Separate lot', 'South gate', '', 1, 1);
  select revision into v_revision from public.parking_revision;
  v_count := public.mark_all_manual_free(current_setting('parking.test_lot')::uuid);
  if v_count <> 9 then raise exception 'FAIL: bulk write did not mark exactly 9 manual slots'; end if;
  if exists (select 1 from public.parking_slots
    where lot_id = current_setting('parking.test_lot')::uuid and input_mode = 'manual'
      and (occupancy <> 'free' or observed_at is null or input_source <> 'manual_demo'))
    then raise exception 'FAIL: bulk write not persisted with observation/source'; end if;
  if (select occupancy from public.parking_slots where id = v_slot) <> 'unknown'
    then raise exception 'FAIL: bulk write changed sensor occupancy'; end if;
  if exists (select 1 from public.parking_slots where lot_id = v_other and occupancy <> 'unknown')
    then raise exception 'FAIL: bulk write affected another lot'; end if;
  if (select revision from public.parking_revision) <> v_revision + 1
    then raise exception 'FAIL: bulk write should emit one atomic invalidation'; end if;
  begin
    perform public.mark_all_manual_free('00000000-0000-4000-8000-000000000000');
    raise exception 'FAIL: bulk write succeeded for missing lot';
  exception when insufficient_privilege then null; end;
  select revision into v_revision from public.parking_revision;
  perform public.publish_parking_lot(current_setting('parking.test_lot')::uuid, false);
  if (select revision from public.parking_revision) <= v_revision then raise exception 'FAIL: unpublish emitted no invalidation'; end if;
end;
$$;
select set_config('request.jwt.claim.sub', 'f0100000-0000-4000-8000-000000000002', true);
do $$
declare v_id text := current_setting('parking.test_lot'); v_data jsonb;
begin
  v_data := public.parking_snapshot();
  if exists (select 1 from jsonb_array_elements(v_data->'lots') l where l->>'id' = v_id)
    then raise exception 'FAIL: snapshot leaks unpublished lot'; end if;
  if exists (select 1 from jsonb_array_elements(v_data->'slots') s where s->>'lot_id' = v_id)
    then raise exception 'FAIL: snapshot leaks unpublished slots'; end if;
end;
$$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.parking_snapshot();
    raise exception 'FAIL: anonymous snapshot access';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.parking_lots;
    raise exception 'FAIL: anonymous table access';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_parking_lot('Anonymous', 'Gate', '', 1, 1);
    raise exception 'FAIL: anonymous function access';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mark_all_manual_free(current_setting('parking.test_lot')::uuid);
    raise exception 'FAIL: anonymous bulk function access';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
rollback;
