import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { serviceById } from "../salon.ts";
import { describeLocal } from "../slots.ts";
import { upcomingBookingsForStylist, type BookingWithNames } from "../bookings.ts";
import { now as clockNow } from "../clock.ts";
import { requireRole } from "../middleware.ts";
import { esc, flash, page } from "../render.ts";

function scheduleRow(booking: BookingWithNames): string {
  const service = serviceById(booking.service_id);
  return `<tr>
    <td data-label="When">${esc(describeLocal(booking.start_utc))}</td>
    <td data-label="Service">${esc(service?.name ?? booking.service_id)}</td>
    <td data-label="Customer">${esc(booking.customer_name)}</td>
    <td data-label="Reference"><span class="ref-code">${esc(booking.ref)}</span></td>
    <td data-label="Status">Confirmed</td>
  </tr>`;
}

export function stylistRoutes(deps: { db: DatabaseSync }): Router {
  const router = Router();
  const { db } = deps;

  // Read-only: a stylist sees their own upcoming schedule and there is no
  // route that lets a stylist change any booking.
  router.get("/stylist", requireRole("stylist"), (req, res) => {
    // stylists.id is NOT users.id — resolve the stylist row from the login user.
    const stylistRow = db.prepare("SELECT id FROM stylists WHERE user_id = ?").get(req.user!.id) as
      | { id: number }
      | undefined;
    const bookings = stylistRow ? upcomingBookingsForStylist(db, stylistRow.id, clockNow()) : [];
    const rows = bookings.map(scheduleRow).join("\n");
    const content = `
    <h1>My schedule</h1>
    ${flash("Read-only view. Changes to bookings are made by the salon admin or the customer.", "info")}
    ${bookings.length === 0
      ? `<div class="empty-state"><p><strong>No upcoming appointments.</strong><br>
         Bookings that customers make with you will appear here automatically.</p></div>`
      : `<div class="card"><div class="table-wrap"><table class="stacked">
          <thead><tr><th>When</th><th>Service</th><th>Customer</th><th>Reference</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div></div>`}`;
    res.send(page({ title: "My schedule", user: req.user ?? null, active: "schedule", content }));
  });

  return router;
}
