-- Transactional booking emails (confirmation, reminder, cancellation).
-- One row per booking and kind, so a message is never sent twice.

create type booking_message_kind as enum ('confirmation', 'reminder', 'cancellation');

create table booking_messages (
  booking_id uuid not null references bookings on delete cascade,
  kind booking_message_kind not null,
  email text not null,
  status recipient_status not null default 'queued',
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (booking_id, kind)
);

alter table booking_messages enable row level security;
create policy booking_messages_read on booking_messages for select to authenticated
  using (exists (select 1 from bookings b where b.id = booking_id and is_venue_member(b.venue_id)));
