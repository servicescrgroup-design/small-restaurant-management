-- Mise: reading menu photos (api/menu-scan.ts) is a yearly-plan feature.
--
--   yearly plan (active)  → included, up to 20 reads a day (fair use)
--   free trial            → 3 reads in total, to try it
--   monthly / expired     → not included
--
-- The server function checks menu_read_status before calling the AI and records the read with
-- record_menu_read only after it succeeded, so failed reads never count. Both run with the signed-in
-- user's token, so membership is checked. Browsers can see the counts but can't lower them.

create table public.business_menu_reads (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  trial_reads int not null default 0,
  total_reads int not null default 0,
  day date not null default current_date,
  day_reads int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.business_menu_reads enable row level security;

create policy "members read their photo reads" on public.business_menu_reads
  for select to authenticated using (public.is_business_member(business_id));

-- What this business may do right now: plan ('yearly' | 'trial' | 'none'), whether a read is
-- allowed, and how many trial reads are left.
create function public.menu_read_status(p_business uuid)
returns table (plan text, allowed boolean, trial_left int, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.business_subscriptions;
  r public.business_menu_reads;
  v_today int;
begin
  if not public.is_business_member(p_business) then
    raise exception 'not a member of this business' using errcode = '42501';
  end if;
  select * into s from public.business_subscriptions where business_id = p_business;
  select * into r from public.business_menu_reads where business_id = p_business;
  v_today := case when r.day = current_date then coalesce(r.day_reads, 0) else 0 end;

  if s.status in ('active', 'past_due') and s.plan = 'yearly'
     and coalesce(s.current_period_end, now()) + interval '3 days' > now() then
    return query select 'yearly', v_today < 20, null::int, case when v_today < 20 then null else 'daily_limit' end;
  elsif s.status = 'trialing' and s.trial_ends_at > now() then
    return query select 'trial', coalesce(r.trial_reads, 0) < 3, greatest(0, 3 - coalesce(r.trial_reads, 0)),
      case when coalesce(r.trial_reads, 0) < 3 then null else 'trial_used' end;
  else
    return query select 'none', false, 0, 'yearly_only';
  end if;
end;
$$;

-- Count one successful read.
create function public.record_menu_read(p_business uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  st record;
begin
  select * into st from public.menu_read_status(p_business);
  insert into public.business_menu_reads as m (business_id, trial_reads, total_reads, day, day_reads)
    values (p_business, case when st.plan = 'trial' then 1 else 0 end, 1, current_date, 1)
  on conflict (business_id) do update set
    trial_reads = m.trial_reads + case when st.plan = 'trial' then 1 else 0 end,
    total_reads = m.total_reads + 1,
    day_reads = case when m.day = current_date then m.day_reads + 1 else 1 end,
    day = current_date,
    updated_at = now();
end;
$$;

revoke all on function public.menu_read_status(uuid) from public, anon;
revoke all on function public.record_menu_read(uuid) from public, anon;
grant execute on function public.menu_read_status(uuid) to authenticated;
grant execute on function public.record_menu_read(uuid) to authenticated;
