-- Mise: one private data space per business.
--
-- * businesses        — a restaurant account (name, who created it)
-- * business_members  — which logins can open which business (owner / manager)
-- * business_data     — the business's whole app state (menu, stock, orders…) as JSON + a revision id
-- * business_heads    — tiny row per business with the latest revision, published to Realtime so
--                       other devices know to reload (the full state is too big to broadcast)
--
-- Row Level Security: a login can only ever see businesses it is a member of. All writes go
-- through the security-definer functions below, which check membership themselves.

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'manager')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index business_members_user_idx on public.business_members (user_id);

create table public.business_data (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  state jsonb not null,
  rev text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table public.business_heads (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  rev text not null,
  updated_at timestamptz not null default now()
);

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.business_data enable row level security;
alter table public.business_heads enable row level security;

-- Membership checks (security definer so policies don't recurse into business_members' own policy)
create function public.is_business_member(p_business uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business and m.user_id = (select auth.uid())
  );
$$;

create function public.is_business_owner(p_business uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

create policy "members read their business" on public.businesses
  for select to authenticated using (public.is_business_member(id));
create policy "owners rename their business" on public.businesses
  for update to authenticated using (public.is_business_owner(id)) with check (public.is_business_owner(id));

create policy "members see co-members" on public.business_members
  for select to authenticated using (public.is_business_member(business_id));

create policy "members read business data" on public.business_data
  for select to authenticated using (public.is_business_member(business_id));

create policy "members read business head" on public.business_heads
  for select to authenticated using (public.is_business_member(business_id));

-- Create a business owned by the signed-in user, with its starting data.
create function public.create_business(p_name text, p_state jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_rev text := gen_random_uuid()::text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if (select count(*) from public.business_members where user_id = v_uid and role = 'owner') >= 20 then
    raise exception 'too many businesses for one account' using errcode = '54000';
  end if;
  if pg_column_size(p_state) > 20 * 1024 * 1024 then
    raise exception 'data too large' using errcode = '54000';
  end if;
  insert into public.businesses (name, created_by) values (btrim(p_name), v_uid) returning id into v_id;
  insert into public.business_members (business_id, user_id, role) values (v_id, v_uid, 'owner');
  insert into public.business_data (business_id, state, rev, updated_by) values (v_id, p_state, v_rev, v_uid);
  insert into public.business_heads (business_id, rev) values (v_id, v_rev);
  return v_id;
end;
$$;

-- Save only if the caller's data is based on the latest revision. Otherwise return the latest
-- state so the app can re-apply its own unsaved changes on top (same rule as between tabs).
create function public.save_business_data(p_business uuid, p_state jsonb, p_base_rev text)
returns table (ok boolean, rev text, state jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_rev text := gen_random_uuid()::text;
begin
  if not public.is_business_member(p_business) then
    raise exception 'not a member of this business' using errcode = '42501';
  end if;
  if pg_column_size(p_state) > 20 * 1024 * 1024 then
    raise exception 'data too large' using errcode = '54000';
  end if;
  update public.business_data d
     set state = p_state, rev = v_rev, updated_at = now(), updated_by = (select auth.uid())
   where d.business_id = p_business and d.rev = p_base_rev;
  if found then
    update public.business_heads h set rev = v_rev, updated_at = now() where h.business_id = p_business;
    return query select true, v_rev, null::jsonb;
  else
    return query select false, d.rev, d.state from public.business_data d where d.business_id = p_business;
  end if;
end;
$$;

-- Permanently delete a business; the caller must be an owner and type its exact name.
create function public.delete_business(p_business uuid, p_confirm_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_business_owner(p_business) then
    raise exception 'only an owner can delete this business' using errcode = '42501';
  end if;
  if not exists (select 1 from public.businesses b where b.id = p_business and b.name = p_confirm_name) then
    raise exception 'name does not match' using errcode = '22023';
  end if;
  delete from public.businesses where id = p_business;
end;
$$;

revoke all on function public.create_business(text, jsonb) from public, anon;
revoke all on function public.save_business_data(uuid, jsonb, text) from public, anon;
revoke all on function public.delete_business(uuid, text) from public, anon;
grant execute on function public.create_business(text, jsonb) to authenticated;
grant execute on function public.save_business_data(uuid, jsonb, text) to authenticated;
grant execute on function public.delete_business(uuid, text) to authenticated;

-- Live updates: devices listen for the small "head" row changing, then fetch the new state.
alter publication supabase_realtime add table public.business_heads;
