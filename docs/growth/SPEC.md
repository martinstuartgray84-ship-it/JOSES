# Product spec, version 1

## The product in one sentence

A manager signs in, uploads three files, and from then on the team has a saved scoreboard, a gains board and a weekly scorecard.

## Why it exists

Independent restaurants hold item-level, timestamped data in their till and make decisions on last week's total. The method behind this product is "big bets on new hours, marginal gains in every hour": a few large moves open up unsold time, and many small measured tests raise what each existing hour earns. The app is the scoreboard and the test log for that method. See `docs/METHOD.md`.

## Users and roles

| Role | Can |
| --- | --- |
| Owner | Everything for their organisation, including venues, users and billing later |
| Manager | Upload data, edit venue settings, manage ideas, tests and gains, see all views |
| Captain | Add ideas, run tests in their area, see all views except individual server figures unless allowed |
| Viewer | Read-only |

One organisation has one or more venues. A user belongs to one organisation and may have a different role per venue.

## Modules in version 1

### 1. Data in
- Upload CSV files of three types: checks (required), items, bookings.
- Column mapping: auto-match using the aliases in `docs/DATA_CONTRACT.md`, let the user correct it, save the mapping per venue and file type, reuse it next time.
- Validation report: rows read, rows loaded, rows skipped with reasons, date range covered.
- Idempotent: natural key per row (see data contract). Re-upload replaces, never duplicates.
- After load, run the engine and store hourly and daily summaries.

### 2. Scoreboard (prototype view: Overview)
- Period selector: 4 weeks, 12 weeks, all. Comparison with the prior period of equal length.
- Nine tiles: net sales per week, covers per week, spend per head, drinks per cover, turn time, RevPASH Friday and Saturday 19:00 to 21:00, share of sales after 22:00, no-show rate, gross margin. Each with change on prior and good/bad direction.
- Weekly charts: sales with spend per head; drinks per cover; turn time.
- "What needs attention": rule-based flags as in the prototype's `overview()`.
- Table by part of day: lunch and afternoon, dinner, late.

### 3. Seat-hours
- Heatmap by day of week and hour: RevPASH or seat occupancy. Party-size table with turn time and spend.

### 4. Menu
- Popularity against margin per sale, within food and within drink. Class per item: Star, Plough horse, Puzzle, Dog, with the action text.

### 5. Team
- Per server: covers, spend per head, drinks per cover, starters and desserts per cover, index against median. Weekly prize from lifting the lower half to the median. Visibility controlled by role.

### 6. Bookings
- Totals, no-show and cancellation rates, weekly no-show trend, table by channel with lead time.

### 7. Tests (prototype view: Initiatives, extended)
- A test has: name, gain area, primary metric, guardrail metric, design (before/after, alternate weeks, split by section), start and end dates, pass mark, owner, status (planned, live, read, banked, stopped), notes.
- Readout: baseline against test period for the primary metric and the guardrail; for alternate-week designs, on-weeks against off-weeks.
- Decision recorded with date and who made it.

### 8. Gains board
- Three columns: ideas, live tests, banked gains.
- Idea card: what would change, which number it should move, how to test it, what could go wrong for the guest, proposer, gain area.
- A banked gain stores the measured change and an estimated yearly value. Running total at the top.
- Must work well on a phone: adding an idea takes under 30 seconds.

### 9. Weekly scorecard
- Generated every Monday for the previous trading week: the nine tiles, change on prior week and on four-week average, live tests and their status, gains banked this week.
- Viewable in-app and emailed to managers.

### 10. Bridge
- Editable assumptions from a base figure to a target multiple, drawn as a waterfall. Saved per venue.

### 11. Events, simple
- Enquiry log: date received, source, type, requested date, size, quote, outcome, reason lost, response time.
- Event record: revenue, cost of goods, extra labour, direct costs, normal sales displaced, contribution rate. Net gain = revenue − cost of goods − labour − direct costs − displaced sales × contribution rate.
- Minimum spend grid: normal net sales for each day and time slot from the heatmap × (1 + premium).

## Venue settings

Name, seats, bar seats, trading hours per day, currency (GBP only in version 1), gain areas and their captains, who may see server-level figures.

## Non-functional

- A venue with two years of data (roughly 20,000 checks, 150,000 item lines) loads any view in under 2 seconds from stored summaries.
- An import of that size completes in under 2 minutes.
- Works on a phone at 380px wide. Light and dark themes.
- Every figure shown can be traced to a definition in `docs/DEFINITIONS.md`.

## Later, not now

Guests and membership, connectors to tills and booking systems, forecasting, benchmarks across venues, an assistant that explains the week and proposes the next test, billing.

## Commercial context (hypotheses)

Buyer: owner or operations lead of one to five full-service restaurants or bars, £500k to £3m sales a site. Offers: diagnostic £4,000 fixed; programme £2,500 a month plus 10% of measured extra gross profit; app only £199 a site a month. None of this is tested.
