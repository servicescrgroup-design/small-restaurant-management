-- Mise: 30-day free trial, then ฿99/month or ฿999/year.
--
-- Every business gets a subscription row when it's created, starting a 30-day trial. Saving data
-- requires an active trial or a paid plan (checked here in the database, so it can't be bypassed
-- from the browser). Reading and exporting data is always allowed.
--
-- Stripe isn't connected yet. Later, a Stripe webhook (running with the service role) will set
-- status / plan / current_period_end and the stripe_* ids; browsers can only read this table.

create table public.business_subscriptions (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled')),
  plan text check (plan in ('monthly', 'yearly')),
  trial_ends_at timestamptz not null default (now() + interval '30 days'),
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  updated_at timestamptz not null default now()
);

alter table public.business_subscriptions enable row level security;

create policy "members read their subscription" on public.business_subscriptions
  for select to authenticated using (public.is_business_member(business_id));

-- Start the trial for every new business (and any created before this migration).
create function public.start_business_trial()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_subscriptions (business_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger businesses_start_trial
  after insert on public.businesses
  for each row execute function public.start_business_trial();

insert into public.business_subscriptions (business_id)
  select id from public.businesses on conflict do nothing;

-- Can this business still save? Trial not over, or a paid period not over (+3 days grace for renewals).
create function public.business_has_access(p_business uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_subscriptions s
    where s.business_id = p_business
      and (
        (s.status = 'trialing' and s.trial_ends_at > now())
        or (s.status in ('active', 'past_due') and coalesce(s.current_period_end, now()) + interval '3 days' > now())
      )
  );
$$;

-- Same as before, plus the access check.
create or replace function public.save_business_data(p_business uuid, p_state jsonb, p_base_rev text)
returns table (ok boolean, rev text, state jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_rev text := gen_random_uuid()::text;
begin
  if not public.is_business_member(p_business) then
    raise exception 'not a member of this business' using errcode = '42501';
  end if;
  if not public.business_has_access(p_business) then
    raise exception 'subscription_required' using errcode = 'P0001';
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

revoke all on function public.save_business_data(uuid, jsonb, text) from public, anon;
grant execute on function public.save_business_data(uuid, jsonb, text) to authenticated;

-- Devices hear when the plan changes (e.g. after paying) and unlock straight away.
alter publication supabase_realtime add table public.business_subscriptions;
