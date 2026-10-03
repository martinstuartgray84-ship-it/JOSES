# What we're building

One system for the whole restaurant: bookings, the till, the kitchen and bar, guests, marketing and the numbers. Most venues today stitch together four or five products (ResDiary or OpenTable, a POS like Lightspeed or Square, a kitchen screen, Mailchimp, a reporting add-on). Each holds a slice of the data, so nobody can answer simple questions like "which regulars stopped coming?" or "why was table 12's main 25 minutes late?".

Owning every piece means one guest record, one timeline from booking to bill, and no per-cover fees or add-on charges.

## Decisions

### 1. Bookings (built)
- Online booking widget, embeddable per site, with availability that respects turn times, pacing and joinable tables.
- Host diary: timeline, floor plan, seat / finish / no-show.
- Guest self-serve view and cancel.
- **Next:** walk-ins and phone bookings from the diary, waitlist, deposits and card holds, email and SMS confirmations.

### 2. Menu
- **Structure:** menus contain categories, which contain items. Items have modifier groups (e.g. "Steak temperature": rare / medium / well, required, pick one) and add-ons with a price.
- **Item details:** price (VAT-inclusive, in pence), cost (for margins), allergens (the 14 UK ones), dietary tags, description.
- **Routing:** each item says which station makes it (kitchen, bar, pastry, ...) and its default course (drinks, starters, mains, desserts).
- **Prep time per item.** This drives kitchen sequencing (below), and is the thing no mainstream POS uses properly.
- **86 from anywhere:** marking an item unavailable hides it on the POS immediately, at that site only.
- **Two sites, one menu:** each site can hide items or override prices.
- **Loading a menu:** paste or upload a spreadsheet (CSV) and it builds the categories, items and modifiers. Later: photograph a printed menu and let Claude read it.

### 3. POS (the till)
- **Opening a check:** open one on a table. If the table has a booking, it links automatically, so spend lands on the guest's profile.
- **Ordering:** tap items, pick modifiers, set seat and course, add notes ("no onions").
- **Send, then fire:** send sends drinks and the first course now and holds later courses. *Fire mains* releases them when the table is ready. That's how good kitchens work, and most POSes only fake it.
- **Voids and comps:** both need a reason, and both are reported.
- **Payments:**
  - Discounts by percent or amount, and an optional service charge.
  - Split equally, by seat, or by item.
  - Cash or card, with tips.
  - VAT breakdown on the receipt.
- **Staff identity:** each person signs in to the till with a PIN, so sales and speed are attributed to the right server.

### 4. Kitchen and bar screens
- **One screen per station.** Bar tickets only show drinks; kitchen tickets only show food. Everything arrives the instant the server presses send.
- **Sequencing ("cook to sync"):** within a ticket, the screen tells the chef when to start each item so everything is ready together.
  - Example: a steak (14 min) and a salad (4 min) on the same ticket. The steak says *start now*; the salad says *start in 10 min*.
  - Tickets are ordered by when they need to start, not by when they arrived, and late tickets jump up.
- **Timers:** colour shifts from green to amber to red against each ticket's target, based on its items' prep times.
- **All-day counts:** "6 × ribeye, 4 × burger" across every open ticket, so the grill can batch.
- **Bump flow:** start, ready, then the pass marks it served.
- **Course firing:** held courses show as greyed "on hold" so the kitchen can see what's coming.

### 5. Timing (what you asked for)
Every item records when it was ordered, sent, started, ready and served. From that:

- **Drinks delivery time:** order to served, per bar and per hour.
- **Food delivery time:** fire to served, per course, per station and per dish.
- **Kitchen time vs pass time:** how long food is cooking versus how long it sits waiting to be run.
- **Table timeline:** seated, then first drink, then starters, mains, bill and paid. This shows exactly where a slow table lost its time.

### 6. Guests (CRM)
- **One profile per person across both sites.** It covers visits, total spend, average spend, favourite dishes and drinks, allergies, no-shows, tags and notes.
- **Segments:** regulars, lapsed regulars, big spenders, first-timers, birthdays this month, no-show risks.
- **Hosts see it on arrival:** the diary flags regulars and past no-shows (built).

### 7. Marketing
- **Campaigns:** emails to a segment, sent only to people who opted in (UK GDPR / PECR), each with a one-click unsubscribe.
- **Automations:**
  - "We miss you" when a regular hasn't been back in 45 days.
  - A thank-you and review request the morning after a visit.
  - A birthday offer.
- **Results:** sends, opens, and the bookings that came back within 30 days. This is revenue attributed to the campaign, not just opens.

### 8. Owner dashboard
- **Today, live:** covers booked versus seated, sales so far, average spend per head, and current ticket times.
- **Trends:** sales, covers, spend per head, table turns and no-show rate, by day and week, for both sites side by side.
- **Menu engineering:** each dish plotted by popularity against margin, as stars, plowhorses, puzzles and dogs. It shows what to promote, reprice or cut.
- **Service speed:** drinks and food times by hour, station and server, and the slowest dishes.
- **Guests:** new versus returning, repeat rate, and the lifetime value of a regular.
- **Bookings:** lead time, channel, cancellation and no-show rates, and empty seats by slot.

## Where this beats the field

| | Typical stack | This |
|---|---|---|
| Pricing | Per cover, or per add-on | One price, everything in |
| Guest data | Split across booking, POS and email tools | One profile, from booking to bill |
| Kitchen sequencing | Tickets in arrival order | Start times so items finish together, ordered by urgency |
| Courses | Server shouts "away" | Hold and fire, tracked per course |
| Speed metrics | Ticket age at best | Ordered, started, ready and served per item, per station, per dish |
| Marketing | Separate tool, guessing who visited | Segments from real visits and spend; results counted in bookings |
| Two sites | Two accounts | One company view, with each site's settings |

## Build order

1. ~~Bookings and diary~~
2. Data model for menu, stations, staff, orders and tickets
3. Bill maths and kitchen sequencing, as pure tested functions (like the availability engine)
4. Menu editor and import
5. POS
6. Kitchen and bar screens
7. Owner dashboard
8. Guest CRM and marketing
9. Demo data and an end-to-end check of every screen

**Deliberately later:**
- **Card terminals.** These need a Stripe Terminal or Dojo integration and hardware. For now the till records card payments taken on the existing terminal.
- **EPOS hardware printers.**
- **Reserve with Google.** It needs partner approval.
- **SMS.** It needs a provider account.
