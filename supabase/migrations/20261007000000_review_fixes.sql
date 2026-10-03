-- Fixes from code review.

-- 1. Remember a booking's planned length. Finishing a table early shortens
--    duration_minutes so the table frees up; undoing that restores the plan.
alter table bookings add column booked_duration_minutes int;
update bookings set booked_duration_minutes = duration_minutes;
alter table bookings alter column booked_duration_minutes set not null;

create function bookings_keep_planned_duration() returns trigger
language plpgsql as $$
begin
  if new.booked_duration_minutes is null then
    new.booked_duration_minutes := new.duration_minutes;
  end if;
  return new;
end $$;

create trigger bookings_keep_planned_duration before insert on bookings
  for each row execute function bookings_keep_planned_duration();

-- 2. Failed staff sign-ins, for rate limiting the shared password.
create table staff_login_failures (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index staff_login_failures_recent on staff_login_failures (at);
create index staff_login_failures_ip on staff_login_failures (ip, at);
alter table staff_login_failures enable row level security; -- server only: no policies
