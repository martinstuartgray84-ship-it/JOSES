# JOSES

One system for running the restaurant: bookings, the till, kitchen and bar screens, the menu, guests, marketing and the owner's numbers. No per-cover fees, no add-ons. See [docs/PRODUCT.md](docs/PRODUCT.md) for the feature decisions and why.

It's built for one company running two sites. Each site has its own floor plan, services, diary, stations and tills. The menu and the guest list are shared across the company, so a regular at one site is recognised at the other.

| Screen | Where | What it does |
|---|---|---|
| Booking widget | `/book` | Guests book online; embeddable per site |
| Manage booking | `/manage/<token>` | Guest's private link to view or cancel |
| Diary | `/diary/<site>` | Timeline and floor plan of the day's bookings; seat, finish, no-show; walk-ins and phone bookings |
| Till | `/pos/<site>` | PIN sign-in, tables, checks, seats, courses, send/fire, voids, comps, discounts, split payments |
| Kitchen & bar | `/kds/<site>/<station>` | Station screens with cook-to-sync sequencing, timers, all-day counts, bump and recall; the pass |
| Menu | `/menu/<site>` | Edit items, prices, GP%, allergens, routing, prep times; 86 and stock per site; spreadsheet import |
| Dashboard | `/dashboard` | Sales, covers, spend per head, service speed, slow dishes, menu engineering, busy times, bookings, guests, team |
| Guests | `/guests` | Every guest with visits and spend; segments; full profile with favourites, history, allergies, consent |
| Marketing | `/marketing` | Campaigns to segments with live preview and test send; win-back, thank-you and birthday automations; results by return visits |

| Code | Where |
|---|---|
| Availability engine | `src/availability` |
| Bill maths (VAT, service, splits) | `src/pos/totals.ts` |
| Kitchen sequencing (cook to sync) | `src/kitchen/sequencing.ts` |
| Menu import parser | `src/menu/import.ts` |
| Segments and email templates | `src/marketing` |
| Server services | `src/server/*.ts` (bookings, diary, menu, orders, kitchen, analytics, crm, marketing) |
| Schema | `supabase/migrations` |
| Seed and demo history | `supabase/seed.sql`, `supabase/demo/history.sql` |

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
npm run db:demo    # optional: 120 days of made-up history so the dashboard has something to show
cp .env.example .env.local   # set STAFF_PASSWORD and STAFF_SESSION_SECRET
npm run dev        # http://localhost:3000/book (guests) and /diary (staff)
```

`npm run db:reset` wipes and reseeds; `npm run db:stop` stops it. Seeded till PINs: Maria 1111, Tom 2222, Aisha 3333, Leo 4444 (change them).

## Till and kitchen

- **Send and fire.** Send goes to the stations straight away: drinks always, plus food up to the first course not yet in the kitchen. Later courses are held, and the check shows *Fire mains · ~14m* when the earlier course is done. One ticket is made per station and course.
- **Cook to sync.** Each ticket's target is its fire time plus its longest dish. Every item gets a start-by time, so a 14-minute steak says *Start now*, the burger *Start in 4m* and the fries *Start in 9m*. Station screens order tickets by who must start soonest; rush tickets jump the queue.
- **Bar and pass.** Bar tickets are served as soon as they're made. Kitchen plates go to the pass, which shows what's waiting and marks it served. A site without a pass station serves plates on ready.
- **Timing.** Every item records ordered, sent, started, ready and served, which is what the dashboard's service-speed numbers come from.
- **Stock.** Set a portion count on an item and it counts down as items are sent, 86ing itself at zero.

## Booking emails

Guests get a confirmation when they book (online or by phone), a reminder about a day before, and a note if the booking is cancelled. These are service messages, so they don't need marketing consent. Each is sent at most once per booking. Failed sends are retried for up to two days.

## Hourly job

Call `GET /api/cron/hourly` with `Authorization: Bearer $CRON_SECRET` once an hour (Vercel Cron, Supabase `pg_cron` + `pg_net`, or any scheduler). It sends day-before reminders, runs marketing automations and retries failed emails. Running it more often is safe: nothing is ever sent twice.

## Marketing

- Only guests who opted in, haven't unsubscribed and have an email are ever messaged. Each opt-in records when and how it was given.
- Every email has a one-click unsubscribe (`List-Unsubscribe` headers and `/u/<token>`).
- Delivery uses [Resend](https://resend.com) when `RESEND_API_KEY` and `EMAIL_FROM` are set. Without them, sends are recorded as "logged" and nothing is delivered.
- Results lead with **came back**: recipients with a paid visit within 30 days. Opens are tracked with a pixel but are only a rough guide.
- Automations run from the hourly job. Each guest gets an automation at most once per occasion, and at most one automated email a week.
- A guest who unsubscribed can't be opted back in from the public booking form; staff can re-add them from the profile, with a note of how they agreed. Public bookings fill in missing guest details but never overwrite existing ones.

## Host diary

`/diary` (staff sign-in required) opens a site's day. Site tabs switch between the two sites, and the arrows move through days.

- **Summary**: covers and bookings per service, how many are in or done, no-shows, and the room's seat count.
- **Timeline**: one row per table, time across the top. Each booking is a block coloured by status, followed by its reset time. A red line marks now. The arrivals strip shows covers arriving per 15 minutes, so the busy points stand out. Blocked tables (e.g. "Wobbly leg") show hatched.
- **Floor**: every table's state at the time on the slider. The states are seated (with when it's due to finish), running over, booked and due, late, free with the next booking, or blocked. Seated guests keep the table until someone finishes it, even past their booked time.
- **Booking panel**: tap any booking to see the guest's phone, notes, history across both sites (★ regular, ! previous no-show) and the actions for its status.
- **Actions**: seat, finish (frees the table now), back to booked, no-show, or cancel. Undoing a finish puts the table back on hold for its planned time. Reinstating a cancelled booking is refused if its table has been rebooked since.
- **New booking**: *Walk-in now* seats a party immediately at the best free table, or one you choose. It uses the same fit and overlap rules as online bookings. *Booking* takes a phone booking at any free time, with a confirmation email if you add their email.
- Refreshes every 30 seconds while open, so online bookings appear without reloading.

Tables without a saved floor position (`pos_x` as % across the room, `pos_y` in pixels) are laid out in a grid per area.

**Staff access is interim:** one shared `STAFF_PASSWORD`, swapped for a signed, HttpOnly session cookie (`STAFF_SESSION_SECRET`). The diary stays locked if either is unset. Ten wrong passwords from one address in 15 minutes blocks that address. Many failures across all addresses slow every attempt down rather than locking the team out. It's checked on every page and every action. Before go-live, replace it with Supabase Auth so each person has their own login and their role from `company_members` / `venue_members` applies.

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
4. ~~Host diary~~: timeline, floor plan and status actions
5. ~~Menu, till, kitchen and bar screens~~
6. ~~Owner dashboard~~
7. ~~Guest CRM and marketing~~
8. ~~Booking emails, walk-ins and phone bookings~~
9. Next: per-person logins (Supabase Auth); settings screens for services, tables and stations; card terminals (Stripe Terminal or Dojo); deposits and card holds; receipt printing; realtime instead of polling
