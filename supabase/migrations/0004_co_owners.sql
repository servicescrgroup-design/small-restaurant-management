-- Mise: more than one owner per business.
--
-- An owner creates an invite for a specific email address and shares the link (LINE, text…).
-- The invited person signs in or creates an account with that email, opens the link, and becomes
-- an owner of the business. Invites last 7 days and work once. Owners can see everyone who has
-- access and remove other owners; the last owner can't be removed.

create table public.business_invites (
  code text primary key default replace(gen_random_uuid()::text, '-', ''),
  business_id uuid not null references public.businesses (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  role text not null default 'owner' check (role in ('owner', 'manager')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);
create index business_invites_business_idx on public.business_invites (business_id);

alter table public.business_invites enable row level security;

create policy "owners see their invites" on public.business_invites
  for select to authenticated using (public.is_business_owner(business_id));

-- Invite someone (by email) to own this business with you. Returns the invite code.
create function public.create_business_invite(p_business uuid, p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_code text;
begin
  if not public.is_business_owner(p_business) then
    raise exception 'only an owner can invite' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if (select count(*) from public.business_invites i
       where i.business_id = p_business and i.used_at is null and i.expires_at > now()) >= 10 then
    raise exception 'too many open invites' using errcode = '54000';
  end if;
  if exists (select 1 from public.business_members m join auth.users u on u.id = m.user_id
              where m.business_id = p_business and lower(u.email) = v_email) then
    raise exception 'already a member' using errcode = '23505';
  end if;
  insert into public.business_invites (business_id, email, created_by)
    values (p_business, v_email, (select auth.uid()))
    returning code into v_code;
  return v_code;
end;
$$;

-- Cancel an invite that hasn't been used.
create function public.revoke_business_invite(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_business uuid;
begin
  select i.business_id into v_business from public.business_invites i where i.code = p_code;
  if v_business is null or not public.is_business_owner(v_business) then
    raise exception 'invite not found' using errcode = '42501';
  end if;
  delete from public.business_invites i where i.code = p_code and i.used_at is null;
end;
$$;

-- Join a business with an invite code. The signed-in account's email must match the invite.
create function public.accept_business_invite(p_code text)
returns table (business_id uuid, name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_inv public.business_invites%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  select * into v_inv from public.business_invites i where i.code = p_code for update;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if v_inv.used_at is not null then
    -- Opening the same link again after joining is fine
    if v_inv.used_by = v_uid then
      return query select b.id, b.name from public.businesses b where b.id = v_inv.business_id;
      return;
    end if;
    raise exception 'invite already used' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invite expired' using errcode = '22023';
  end if;
  if v_email is distinct from v_inv.email then
    raise exception 'invite is for a different email' using errcode = '42501';
  end if;
  insert into public.business_members (business_id, user_id, role)
    values (v_inv.business_id, v_uid, v_inv.role)
    on conflict on constraint business_members_pkey do nothing;
  update public.business_invites i set used_by = v_uid, used_at = now() where i.code = p_code;
  return query select b.id, b.name from public.businesses b where b.id = v_inv.business_id;
end;
$$;

-- Everyone with access to a business, with their email (members only).
create function public.list_business_members(p_business uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_business_member(p_business) then
    raise exception 'not a member of this business' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.email::text, m.role, m.created_at, m.user_id = (select auth.uid())
      from public.business_members m join auth.users u on u.id = m.user_id
     where m.business_id = p_business
     order by m.created_at;
end;
$$;

-- An owner removes someone's access (or anyone leaves). The last owner always stays.
create function public.remove_business_member(p_business uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  if p_user <> (select auth.uid()) and not public.is_business_owner(p_business) then
    raise exception 'only an owner can remove people' using errcode = '42501';
  end if;
  select m.role into v_role from public.business_members m where m.business_id = p_business and m.user_id = p_user;
  if v_role is null then return; end if;
  if v_role = 'owner' and (select count(*) from public.business_members m where m.business_id = p_business and m.role = 'owner') <= 1 then
    raise exception 'a business needs at least one owner' using errcode = '22023';
  end if;
  delete from public.business_members m where m.business_id = p_business and m.user_id = p_user;
end;
$$;

revoke all on function public.create_business_invite(uuid, text) from public, anon;
revoke all on function public.revoke_business_invite(text) from public, anon;
revoke all on function public.accept_business_invite(text) from public, anon;
revoke all on function public.list_business_members(uuid) from public, anon;
revoke all on function public.remove_business_member(uuid, uuid) from public, anon;
grant execute on function public.create_business_invite(uuid, text) to authenticated;
grant execute on function public.revoke_business_invite(text) to authenticated;
grant execute on function public.accept_business_invite(text) to authenticated;
grant execute on function public.list_business_members(uuid) to authenticated;
grant execute on function public.remove_business_member(uuid, uuid) to authenticated;
