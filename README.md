# JOSES

A commission-free restaurant reservation platform: online booking, a table diary, and a guest CRM, with no per-cover fees and no add-on charges.

This repo currently holds the two foundations the rest gets built on:

| Piece | Where | What it does |
|---|---|---|
| Availability engine | `src/availability` | A pure TypeScript function that decides which start times to offer a party, and which tables to use |
| Core schema | `supabase/migrations` | The Postgres data model, plus a constraint that stops the database ever double-booking a table |

## Availability engine

`getAvailability({ venue, dayOfWeek, covers, bookings, blocks?, channel?, notBefore? })` returns every slot for the day, with either a table assignment or a reason it's unavailable (`no_table`, `pacing_covers`, `pacing_bookings`, `party_size_out_of_range`, `too_soon`).

`allocate({ ..., serviceId, time, ignoreBookingId? })` picks tables for one specific time. Use it when creating or amending a booking.

It handles:

- **Services** by day of week, with first and last seating, slot interval, and an optional area restriction. A service can run past midnight.
- **Turn times** by party size, plus a reset buffer between parties.
- **Pacing**: a cap on covers and on bookings per slot, so the kitchen isn't hit by 40 covers at 19:30.
- **Table combinations** (joinable tables) for larger parties.
- **Best-fit seating**: least wasted seats first, then single tables before combinations.
- **Channels**: online guests only see `bookableOnline` tables, while staff can seat anywhere.
- **Table blocks** for maintenance or private hire.

Times are minutes from local midnight. The caller converts from the venue's timezone, which keeps the engine free of clock and timezone logic.

## Schema

Here's what's in it:

- Venues and staff roles (owner, manager, host).
- Floor plan: areas, tables, combinations and blocks.
- Services, turn times and closures.
- Payment rules for card holds, deposits and prepayment, set by date, day and party size.
- A guest CRM, with one record per guest per venue.
- Bookings and their tables.
- Stripe payments.

**Double-booking guard:** `booking_tables` has a `btree_gist` exclusion constraint on `(table_id, blocked_during)`. It only applies while a booking holds its table (pending, confirmed or seated). Triggers keep that time range and status in step with `bookings`, so moving, lengthening, cancelling or reinstating a booking is checked too. If two requests race for the same table, the second gets `23P01`.

**Row-level security:** staff only see the venues they belong to. Hosts run day-to-day bookings, and managers also edit configuration. Public booking goes through server routes that use the service role, so guests never query tables directly. Each booking gets a `manage_token` for the guest's self-serve amend/cancel link.

## Running tests

```sh
npm install
npm test           # engine unit tests
npm run typecheck
npm run test:db    # applies migrations to a throwaway Postgres 15+ and runs supabase/tests/*.test.sql
```

`test:db` stubs the parts of Supabase it needs (the `auth.uid()` function and the database roles), so it runs on plain Postgres without the Supabase CLI.

## Roadmap

1. ~~Availability engine~~ and ~~core schema~~
2. Next.js app on Supabase: an availability API that loads config and bookings and calls the engine, and a booking endpoint that uses `allocate` and retries on `23P01`
3. Embeddable booking widget
4. Host diary for tablets: timeline and floor plan, updated live via Supabase realtime
5. Admin console for services, tables and payment rules
6. Stripe: SetupIntents for card holds, deposits and no-show fees
7. Email and SMS confirmations, reminders, and the amend/cancel link
8. Later: waitlist, vouchers, events, EPOS integration, reporting
