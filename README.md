# JOSES

A commission-free restaurant reservation platform: online booking, a table diary, and a guest CRM, with no per-cover fees and no add-on charges.

It's built for one company running two sites. Each site has its own floor plan, services and diary. Guests are shared across the company, so a regular at one site is recognised at the other.

| Piece | Where | What it does |
|---|---|---|
| Availability engine | `src/availability` | A pure TypeScript function that decides which start times to offer a party, and which tables to use |
| Booking service | `src/server/booking.ts` | Loads a site's day from Postgres, runs the engine, and creates bookings safely under concurrent requests |
| Core schema | `supabase/migrations` | The Postgres data model, plus a constraint that stops the database ever double-booking a table |
| Booking widget | `app/book` | Guest booking flow: site, party size, date, time, details. Works as a page or an iframe embed |
| Manage page | `app/manage/[token]` | The guest's private link to view or cancel their booking |
| API routes | `app/api` | `GET /api/sites`, `GET /api/availability`, `POST /api/bookings`, `DELETE /api/manage/:token` |
| Seed | `supabase/seed.sql` | Placeholder company with two sites, for local development |

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

## Booking service

`siteAvailability(sql, siteSlug, date, covers, { channel?, now? })` returns the engine's slots for one site and local date. It converts times using the site's timezone, so BST changes are handled. It also applies closures, the dates a service runs between, minimum notice and the booking window (the last two for online bookings only).

`createBooking(sql, { siteSlug, date, time, serviceId, covers, guest, channel? })` books a table in one transaction:

1. Takes a per-site, per-date advisory lock, so pacing limits hold when several requests land at once.
2. Re-runs availability on fresh data and picks the tables.
3. Finds or creates the guest in the company-wide list, matching on email first and then phone.
4. Inserts the booking and its tables. If the overlap constraint still fires (a staff edit that skipped the lock), it retries up to three times.

It needs a privileged connection (`DATABASE_URL` or the Supabase service role) and is meant for server routes, never the browser.

## Schema

Here's what's in it:

- One company with several sites. Staff roles (owner, manager, host) can apply company-wide or to one site.
- Floor plan: areas, tables, combinations and blocks.
- Services, turn times and closures.
- Payment rules for card holds, deposits and prepayment, set by date, day and party size.
- A guest CRM shared across the company, with one record per guest. The `guest_stats` view shows visits, no-shows and how many sites each guest has visited.
- Bookings and their tables.
- Stripe payments.

**Double-booking guard:** `booking_tables` has a `btree_gist` exclusion constraint on `(table_id, blocked_during)`. It only applies while a booking holds its table (pending, confirmed or seated). Triggers keep that time range and status in step with `bookings`, so moving, lengthening, cancelling or reinstating a booking is checked too. If two requests race for the same table, the second gets `23P01`.

**Row-level security:** company-wide staff see both sites. Site staff see only their own site's diary, but the whole guest list. Hosts run day-to-day bookings, and managers also edit configuration. Public booking goes through server routes that use the service role, so guests never query tables directly. Each booking gets a `manage_token` for the guest's self-serve amend/cancel link.

## Running the app locally

```sh
npm install
npm run db:start   # local Postgres on :54322 with schema + two-site seed (needs Postgres 15+ installed)
cp .env.example .env.local
npm run dev        # http://localhost:3000/book
```

`npm run db:reset` wipes and reseeds; `npm run db:stop` stops it.

## Embedding on your websites

Each site's website can embed its own widget, with no site picker:

```html
<iframe src="https://book.example.com/book?site=site-one" style="width:100%;max-width:560px;height:900px;border:0" title="Book a table"></iframe>
```

Add the website's origin to `EMBED_ORIGINS`, or browsers will refuse to show the iframe. Manage pages can never be embedded and send no referrer, so the private token doesn't leak.

## Running tests

```sh
npm install
npm test           # engine unit tests
npm run typecheck
npm run test:db    # throwaway Postgres 15+: migrations, seed, SQL tests, then booking-service integration tests
```

`test:db` stubs the parts of Supabase it needs (the `auth.uid()` function and the database roles), so it runs on plain Postgres without the Supabase CLI.

## Roadmap

1. ~~Availability engine~~ and ~~core schema~~
2. ~~Booking service~~ (availability and create-booking against Postgres)
3. ~~Next.js app~~: API routes, embeddable booking widget with a site picker, guest view/cancel page
4. Host diary for tablets: timeline and floor plan, updated live via Supabase realtime
5. Admin console for services, tables and payment rules
6. Stripe: SetupIntents for card holds, deposits and no-show fees
7. Email and SMS confirmations, reminders, and the amend/cancel link
8. Later: waitlist, vouchers, events, EPOS integration, reporting
