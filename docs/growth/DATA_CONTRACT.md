# Data contract

Three CSV files. Headers are matched case-insensitively after trimming and replacing spaces and hyphens with underscores, so "Check ID" matches `check_id`. The prototype's `fromRows` in `prototype/engine.js` is the reference implementation.

## Time

- Accepted: `YYYY-MM-DD HH:MM[:SS]`, ISO `YYYY-MM-DDTHH:MM[:SS]`, UK `DD/MM/YYYY HH:MM[:SS]`.
- Stored as wall-clock time with no timezone conversion.
- Trading day: a timestamp belongs to the trading day that started at 05:00. A check opened at 00:30 on Sunday belongs to Saturday. Trading hour runs 5 to 29, so 24 is midnight.
- Weeks start on Monday.

## checks.csv (required)

One row per bill.

| Field | Aliases | Required | Notes |
| --- | --- | --- | --- |
| `check_id` | check, id, order_id | Yes | Natural key with venue |
| `opened_at` | opened, open, opened_time, date | Yes | |
| `closed_at` | closed, close, paid_at | No | Needed for turn time and accurate seat-hours. If missing, 90 minutes is assumed for seat-hours. |
| `table` | table_no | No | |
| `covers` | guests, pax, party_size | No | Defaults to 1 if missing or not positive |
| `server` | waiter, staff, employee | No | Defaults to "Unknown" |
| `net_total` | net, total, net_sales | No | Net of VAT and service charge. If missing, summed from item lines. Currency symbols and commas are stripped. |

## items.csv (optional)

One row per item line. Unlocks drinks, attach rates, menu and margin.

| Field | Aliases | Required | Notes |
| --- | --- | --- | --- |
| `check_id` | check, order_id | Yes | Lines whose check is not in the checks file are ignored |
| `item` | name, product | Yes | |
| `category` | cat | No | Defaults to "Other" |
| `group` | type | No | If present and matches the drink pattern, the line is a drink |
| `qty` | quantity | No | Defaults to 1 |
| `net_price` | net, line_total, total | No | The line total, not the unit price |
| `unit_cost` | cost | No | Recipe cost of one unit. Without it, margin views show price only. |

Drink detection: `group` if given, otherwise `category`, tested against `/cocktail|beer|wine|spirit|soft|drink|tequila|mezcal|marg|bar|beverage/i`. Everything else is food.
Starters: category matches `/starter|appeti|small|botana/i`. Desserts: `/dessert|postre|sweet/i`.

Natural key: venue, `check_id`, `item`, plus a line sequence within the check.

## bookings.csv (optional)

One row per reservation.

| Field | Aliases | Required | Notes |
| --- | --- | --- | --- |
| `booking_id` | id | No | Natural key with venue; row index if missing |
| `booked_for` | datetime, date, reservation_time | Yes | |
| `party_size` | covers, guests | No | Defaults to 2 |
| `status` | | No | Contains "no" → no_show; contains "cancel" → cancelled; otherwise seated |
| `channel` | source | No | Defaults to "Unknown" |
| `created_at` | booked_at | No | Lead time in days = booked_for − created_at, rounded, minimum 0 |

## Fixtures

`fixtures/sample/` holds 26 weeks of invented data for a 60-seat site: 4,394 checks, 34,239 item lines, 3,131 bookings, Tuesday 19 May to Sunday 15 November 2026. The site is closed on Mondays. Built-in effects a correct engine should show: drinks per cover rises about 12% from week 15, no-shows fall by about two-thirds from week 19, turn time falls about 7% from week 21.

`fixtures/golden.json` holds expected engine outputs for that data with 60 seats.
