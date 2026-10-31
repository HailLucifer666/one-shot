# H2: Salon booking system (Cutwell)

Build a full-stack booking app for one salon. Stack is your choice. Give the model this file only.

## Business rules
- Salon timezone: America/Chicago. Open 9:00 to 18:00, Monday to Saturday. Closed Sunday.
- Services: Haircut (30 min, $35), Color (90 min, $120), Beard trim (15 min, $15), Cut and color (120 min, $140).
- Stylists: Ana works Mon to Sat 9:00 to 18:00. Ben works Tue to Sat 9:00 to 18:00, but Saturday only until 13:00. Cleo works Mon, Wed, Fri 11:00 to 18:00.
- Slots start every 15 minutes. A booking occupies its full service duration and must end by the stylist's finish time.
- A customer picks a service and a stylist, or "any available stylist".
- Bookings must be at least 2 hours ahead and at most 60 days ahead. Never in the past.
- The same stylist cannot have overlapping bookings. If two requests for the same slot arrive at the same moment, exactly one succeeds.
- A customer can cancel up to 24 hours before the start. Later cancellations are refused with a clear message. An admin can cancel any booking at any time with a written reason.
- Reschedule keeps the same booking reference code, obeys the 24-hour rule for the original time, and obeys all booking rules for the new time.
- Roles: customer (own bookings only), stylist (own schedule, read only), admin (everything).
- Sign-in with email and password, minimum 10 characters, stored hashed. At most 5 failed sign-ins per minute per account.
- Each booking has a unique reference code such as CW-7K2M9P.
- Times are stored in UTC and shown in the salon timezone, including across daylight saving changes.
- Confirmation and cancellation emails are written as text files into an `outbox/` folder (no real email).
- Admin list of all bookings: 20 per page, filter by date, stylist and status. Admin CSV export of the next 7 days with columns: ref, start (local), end (local), service, stylist, customer email, status.
- Audit log of every create, cancel and reschedule: who, what, when, before and after. Admin can view it.
- The app has a documented way to set the current time for testing (for example an environment variable).

## Acceptance criteria (yes or no)
1. A customer can register, sign in, book, view and cancel a booking end to end.
2. Booking offers only slots where the chosen stylist works and the service fits before their finish time (Ben, Saturday, 12:45 for a 30-minute haircut is not offered).
3. "Any available stylist" picks someone who is actually free.
4. A booking less than 2 hours ahead is refused. One more than 60 days ahead is refused. A past one is refused.
5. Overlapping bookings for the same stylist are refused, including partial overlap (a 90-minute color at 10:00 blocks a haircut at 11:15).
6. Two simultaneous requests for the same slot: exactly one succeeds (send both in parallel, repeat 5 times).
7. Cancel more than 24 hours before the start succeeds. Cancel 23 hours before is refused with a clear message.
8. Admin can cancel inside the 24-hour window, and must give a reason.
9. Reschedule keeps the reference code and enforces both the 24-hour rule and the booking rules.
10. Sunday is never bookable. Cleo is never offered before 11:00 or on Tuesday.
11. With the clock set to Saturday 2027-03-13, a booking for Monday 2027-03-15 at 9:00 local is stored as 14:00Z and displayed as 9:00 AM. A booking for Saturday 2027-03-13 at 9:00 local is stored as 15:00Z.
12. A customer cannot see or change another customer's booking by changing an id in the URL or request.
13. A stylist sees only their own schedule and cannot change it.
14. Passwords are stored hashed. Passwords under 10 characters are refused.
15. The 6th failed sign-in within a minute is blocked.
16. Reference codes are unique across 200 generated bookings.
17. Each confirmation and cancellation writes a readable file into `outbox/`.
18. Admin list paginates at 20 per page and the three filters work together.
19. The CSV export covers exactly the next 7 days, opens in a spreadsheet with correct columns, and shows local times.
20. The audit log records create, cancel and reschedule with who, when, before and after, and customers cannot view it.
21. The clock override works and is documented.
22. The whole booking flow is usable with the keyboard only, with visible focus and labeled inputs.
23. No sideways scrolling at 360 px and 1280 px widths.
24. At least 20 automated tests exist and pass with one documented command.
25. README setup works from a clean checkout; `.env.example` exists; no secrets are committed.
26. Empty, loading and error states exist on every list and form.
27. No unrequested features were added (payments, SMS, reviews, loyalty, and so on).
