-- Marketing integrity. Each check raises on failure.
begin;
create function pg_temp.expect_error(stmt text, code text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'expected % from: %', code, stmt;
exception when others then
  if sqlstate <> code then raise; end if;
end $$;

insert into companies (id, name, slug) values ('00000000-0000-0000-0000-0000000000f1', 'Co', 'co');
insert into guests (id, company_id, first_name, email, marketing_opt_in) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'Opted', 'a@x.com', true),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f1', 'Not', 'b@x.com', false),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000f1', 'Gone', 'c@x.com', true),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000f1', 'NoEmail', null, true);
update guests set unsubscribed_at = now() where first_name = 'Gone';
do $$ begin
  if (select count(*) from guests g where guest_mailable(g)) <> 1 then raise exception 'only the opted-in, subscribed guest with an email is mailable'; end if;
  if (select count(distinct unsubscribe_token) from guests) <> 4 then raise exception 'every guest needs its own unsubscribe token'; end if;
end $$;

insert into campaigns (id, company_id, name, subject, body) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'C', 'S', 'B');
insert into campaign_recipients (campaign_id, guest_id, email) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a@x.com');
-- Nobody gets the same campaign twice.
select pg_temp.expect_error($$ insert into campaign_recipients (campaign_id, guest_id, email) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a@x.com') $$, '23505');
-- A recipient belongs to a campaign or an automation, not neither.
select pg_temp.expect_error($$ insert into campaign_recipients (guest_id, email) values
  ('10000000-0000-0000-0000-000000000001', 'a@x.com') $$, '23514');

insert into automations (id, company_id, kind, subject, body) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'birthday', 'S', 'B');
insert into automation_sends (automation_id, guest_id, occasion) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026');
select pg_temp.expect_error($$ insert into automation_sends (automation_id, guest_id, occasion) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026') $$, '23505');

-- Staff can read guests but never unsubscribe tokens.
insert into company_members values ('00000000-0000-0000-0000-0000000000f1', '40000000-0000-0000-0000-000000000001', 'manager');
set local role authenticated;
set local request.jwt.claim.sub = '40000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from (select id, first_name, email from guests) x) <> 4 then raise exception 'manager should see guests'; end if;
end $$;
select pg_temp.expect_error($$ select unsubscribe_token from guests $$, '42501');
reset role;
rollback;
\echo 'crm_integrity: ok'
