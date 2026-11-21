# Build plan

> **Status.** All six steps are built, inside the Jose's app as its Growth section rather than as a separate
> monorepo. What differs from the plan as written, and why:
>
> - **Layout.** One Next.js app, npm, no Tailwind: the engine is `src/growth/engine` (pure, no I/O), services are
>   `src/server/growth*.ts`, screens are `app/(staff)/growth`. The engine has no imports from the rest of the app
>   and can be lifted into its own package unchanged.
> - **Step 2, accounts.** The console uses the staff sign-in the app already has (one shared password, with till
>   PINs identifying managers). Organisation = company, venue = site. Row-level security for every growth table is
>   in the migration and proven by `supabase/tests/growth_integrity.test.sql`, ready for per-person Supabase Auth.
>   Email sign-up that creates an organisation is not built.
> - **Step 3, import.** Files are parsed and loaded straight into Postgres in pieces; the original file is not kept
>   in Supabase Storage. A real till export from the first site has not been loaded yet.
> - **Step 6, scorecard.** Runs from the existing hourly job. It needs `CRON_SECRET` on a scheduler and
>   `RESEND_API_KEY` to deliver email, and it can only be built once that week's sales have been loaded.

Six steps. Do them in order, one per session where possible. Tick a task when its check passes.

## Step 1. Scaffold and port the engine

- [x] Monorepo with pnpm workspaces: `apps/web` (Next.js, TypeScript, Tailwind), `packages/engine` (TypeScript, Vitest).
- [x] Port `prototype/engine.js` to `packages/engine` as typed pure functions: time helpers, `fromRows`, `build`, `summary`, `weekly`, `heat`, `menu`, `servers`, `parties`, `dayparts`, `channels`, `beforeAfter`, `METRICS`. Leave `sample()` out of the package; fixtures replace it.
- [x] Golden test: load `fixtures/sample/*.csv`, run `fromRows` then `build`, and assert every value in `fixtures/golden.json` within 0.0001.
- [x] Unit tests for `parseTime` (ISO, `YYYY-MM-DD HH:MM`, UK `DD/MM/YYYY HH:MM`), trading-day boundary at 05:00, and column alias matching.

**Done when:** `pnpm test` passes and the last-12-weeks summary equals £17,454.83 sales a week, £32.8871 spend per head, 1.604 drinks per cover.

## Step 2. Accounts, organisations, venues

- [x] Supabase project, migrations from `docs/schema.sql` (treat it as a draft: improve names and types, keep the shape).
- [x] Email sign-in. Organisation and first venue created on sign-up.
- [x] Roles per venue: owner, manager, captain, viewer.
- [x] Row-level security on every table by venue membership.
- [x] Venue settings page: name, seats, trading hours.

**Done when:** an automated test with two users in two organisations proves neither can read or write the other's rows.

## Step 3. Import

Wait for a real till export from the first site before finishing this step.

- [x] Upload to Supabase Storage, one import record per file.
- [x] Column mapping screen: auto-match from aliases, user corrects, mapping saved per venue and file type.
- [x] Parse and validate on the server, upsert on natural keys, write a validation report.
- [x] After load, run the engine and store `metric_hour` and `metric_day` for the affected date range.
- [x] Import history page with the report for each upload.

**Done when:** the sample CSVs load with zero skipped rows, re-uploading adds zero rows, and a real export from the first site loads with a readable report.

## Step 4. Views from stored data

- [x] Port the prototype's eight views to React, reading from stored summaries and engine calls: Scoreboard, Seat-hours, Menu, Team, Bookings, Tests (basic), Bridge, Data.
- [x] Period selector and prior-period comparison shared across views.
- [x] Role check on server-level figures.

**Done when:** every number on every view for the sample venue matches `fixtures/golden.json`, and pages load in under 2 seconds.

## Step 5. Tests and gains board

- [x] Ideas, tests and gains tables and screens as in the spec.
- [x] Test readout with primary metric and guardrail; alternate-week comparison.
- [x] Gains board with running yearly total. Phone-first.

**Done when:** on a phone, a captain can add an idea in under 30 seconds, a manager can turn it into a live test, read it at the end date and bank it.

## Step 6. Weekly scorecard and events

- [x] Scheduled job each Monday 07:00 venue time builds the scorecard and emails managers.
- [x] Enquiry log, event record with net gain, minimum spend grid.

**Done when:** managers receive Monday's scorecard with no manual step, and an event's net gain matches a hand calculation.

## After version 1, in likely order

1. Connector for whichever till the first site uses.
2. Guests: capture rate, second-visit rate, segments.
3. Benchmarks once 20 venues are loaded.
4. Assistant that drafts the weekly narrative and proposes the next test.
