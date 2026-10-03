-- Guest CRM and marketing.
-- Consent is explicit (marketing_opt_in, with when and where it was given) and
-- every guest has a private unsubscribe token. Campaigns write one outbox row
-- per recipient; automations record what they sent so nobody gets a message twice.

alter table guests
  add column allergies text,
  add column birthday_month int check (birthday_month between 1 and 12),
  add column birthday_day int check (birthday_day between 1 and 31),
  add column consent_at timestamptz,
  add column consent_source text,
  add column unsubscribed_at timestamptz,
  add column unsubscribe_token text not null unique default encode(gen_random_bytes(18), 'hex');

-- Can we email this guest marketing right now?
create function guest_mailable(g guests) returns boolean language sql stable as $$
  select g.marketing_opt_in and g.unsubscribed_at is null and g.email is not null
$$;

create type campaign_status as enum ('draft', 'sending', 'sent');

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  name text not null,
  subject text not null,
  body text not null,
  -- Segment definition (see src/marketing/segments.ts).
  segment jsonb not null default '{}',
  status campaign_status not null default 'draft',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create type recipient_status as enum ('queued', 'sent', 'failed', 'logged');

create table campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns on delete cascade,
  automation_id uuid,
  guest_id uuid not null references guests on delete cascade,
  email text not null,
  -- Opaque token for the open pixel.
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  status recipient_status not null default 'queued',
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  opened_at timestamptz,
  check ((campaign_id is null) <> (automation_id is null))
);
create unique index campaign_recipients_once on campaign_recipients (campaign_id, guest_id) where campaign_id is not null;
create index campaign_recipients_guest on campaign_recipients (guest_id, sent_at);

create type automation_kind as enum ('winback', 'thank_you', 'birthday');

create table automations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  kind automation_kind not null,
  enabled boolean not null default false,
  subject text not null,
  body text not null,
  -- winback: {"lapsedDays": 45, "minVisits": 2}; thank_you: {"afterHours": 12}; birthday: {"daysBefore": 7}
  params jsonb not null default '{}',
  last_run_at timestamptz,
  unique (company_id, kind)
);

alter table campaign_recipients add constraint campaign_recipients_automation_fk
  foreign key (automation_id) references automations on delete cascade;

-- One send per automation, guest and occasion (a visit, a lapse, a birthday year).
create table automation_sends (
  automation_id uuid not null references automations on delete cascade,
  guest_id uuid not null references guests on delete cascade,
  occasion text not null,
  recipient_id uuid references campaign_recipients on delete set null,
  created_at timestamptz not null default now(),
  primary key (automation_id, guest_id, occasion)
);

alter table campaigns enable row level security;
alter table campaign_recipients enable row level security;
alter table automations enable row level security;
alter table automation_sends enable row level security;

create policy campaigns_rw on campaigns for all to authenticated
  using (is_company_staff(company_id, 'manager')) with check (is_company_staff(company_id, 'manager'));
create policy automations_rw on automations for all to authenticated
  using (is_company_staff(company_id, 'manager')) with check (is_company_staff(company_id, 'manager'));
create policy recipients_read on campaign_recipients for select to authenticated
  using (exists (select 1 from guests g where g.id = guest_id and is_company_staff(g.company_id, 'manager')));
create policy automation_sends_read on automation_sends for select to authenticated
  using (exists (select 1 from automations a where a.id = automation_id and is_company_staff(a.company_id, 'manager')));

-- Unsubscribe tokens are server-only. A column revoke can't override a table
-- grant, so staff get an explicit column list (add new guest columns here).
revoke select on guests from anon, authenticated;
grant select (id, company_id, first_name, last_name, email, phone, notes, tags, marketing_opt_in,
              stripe_customer_id, created_at, allergies, birthday_month, birthday_day,
              consent_at, consent_source, unsubscribed_at) on guests to authenticated;
