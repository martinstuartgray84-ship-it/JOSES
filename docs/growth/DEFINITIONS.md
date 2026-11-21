# Definitions

The single source for what each number means. Code follows this file.

"Item covers" and "item sales" count only checks that have item lines, so that venues with partial item data are not understated.

| Metric | Key | Definition | Better |
| --- | --- | --- | --- |
| Net sales | `sales` | Sum of check net totals, net of VAT and service charge | Higher |
| Covers | `covers` | Sum of covers on checks | Higher |
| Weeks in period | `weeks` | (last day − first day + 1) ÷ 7 | |
| Net sales per week | `salesPerWeek` | sales ÷ weeks | Higher |
| Covers per week | `coversPerWeek` | covers ÷ weeks | Higher |
| Spend per head | `sph` | sales ÷ covers | Higher |
| Drinks per cover | `dpc` | drink quantity ÷ item covers | Higher |
| Drinks share | `drinkShare` | drink sales ÷ item sales | Higher |
| Starters per cover | `starterAttach` | starter quantity ÷ item covers | Higher |
| Desserts per cover | `dessertAttach` | dessert quantity ÷ item covers | Higher |
| Turn time | `turn` | Mean minutes from check open to close, checks with both times | Lower |
| Gross margin | `gp` | (item sales − recipe cost) ÷ item sales. Null if no costs supplied. | Higher |
| Late share | `lateShare` | Sales on checks opened at trading hour 22 or later ÷ sales | Higher |
| Late sales per week | `lateSalesPerWeek` | Late sales ÷ weeks | Higher |
| No-show rate | `noShow` | no-shows ÷ (no-shows + seated bookings). Cancellations excluded. | Lower |
| Cancellation rate | `cancelRate` | cancelled ÷ all bookings | Lower |

## Seat-hours

- Each check's net total and covers are spread across the clock hours it occupied, in proportion to time in each hour. Duration is close − open, or 90 minutes if no close time.
- Available seat-hours for a day-of-week and hour = seats × number of dates of that weekday in the period with at least one check.
- **RevPASH** = sales in the cell ÷ available seat-hours. **Occupancy** = covers-hours in the cell ÷ available seat-hours, capped at 1.5.
- Headline figures: mean RevPASH for Friday and Saturday 19:00 to 21:00, and for 22:00 to 24:00.

## Menu engineering

Within food and within drink separately:
- Popularity threshold = 0.7 × (group quantity ÷ number of items in the group).
- Margin benchmark = group contribution ÷ group quantity.
- Star: popular and at or above the margin benchmark. Plough horse: popular, below. Puzzle: not popular, at or above. Dog: neither.

## Servers

Median spend per head across servers (mean of the two middle values when even). Weekly prize = sum over servers below the median of (median − their spend per head) × their covers, ÷ weeks.

## Parts of the day

Lunch and afternoon: trading hour before 17. Dinner: 17 to before 22. Late: 22 onward.

## Before and after

Baseline = up to six weeks before the start date, not earlier than the first data. After = start date to the last data. Change = (after − before) ÷ before. A before-and-after comparison does not control for season; alternate-week and split-room designs are preferred.

## Events

Net gain = revenue − cost of goods − extra labour − direct costs − (normal net sales displaced × contribution rate).
Minimum spend for a slot = normal net sales for that slot × (1 + premium).

## Tests

- **Before and after:** as above, with the after period ending at the test's end date when it has one.
- **Alternate weeks:** counting weeks from the start date, the first, third, fifth... are on-weeks and the rest off-weeks. Change = (on-weeks − off-weeks) ÷ off-weeks, inside the test dates only.
- **Split by section:** over the test dates, checks at the listed tables against checks at every other table. Booking figures cannot be split by table and read as no data.
- **Verdict:** too early under two weeks of test data; wrong direction if the change is against the metric's better direction; pass mark met if the change is at least the pass mark; otherwise moving, below pass mark.
- **Guardrail:** breached when the guardrail metric moves in its worse direction by more than 2%.
- **Yearly value, first estimate:** uses the last 12 weeks for volumes. Sales per week and late sales per week: change × 52. Spend per head: change × covers per week × 52. Drinks per cover: change × covers per week × 52 × average drink price. Covers per week: change × spend per head × 52. No estimate for other metrics. The manager can overwrite it.
- **Banked total:** sum of yearly values of banked gains, leaving out any that failed the 90-day re-check.

## Weekly scorecard

The nine scoreboard tiles for one trading week, Monday to Sunday, each against the week before and against the four weeks before taken together.

## Minimum spend slots

Lunch and afternoon: trading hours before 17. Dinner: 17 to before 22. Late: 22 onward. Whole day: all of them. Normal net sales for a slot = mean sales on that weekday in those hours over the selected period.
