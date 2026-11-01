import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import {
  MAX_AHEAD_DAYS,
  SALON_TZ,
  formatPrice,
  labelToMinutes,
  minutesToLabel12,
  serviceById,
} from "../salon.ts";
import { describeLocal } from "../slots.ts";
import {
  bookingsForCustomer,
  cancelBooking,
  getBookingWithNames,
  rescheduleBooking,
  type BookingWithNames,
} from "../bookings.ts";
import { now as clockNow } from "../clock.ts";
import { notFoundPage, requireRole } from "../middleware.ts";
import { buttonRow, errorSummary, esc, flash, page, textField } from "../render.ts";
import { writeOutboxEmail } from "../email.ts";
import { bookingPageContent, slotChoices } from "./book.ts";

function statusBadge(status: string): string {
  return status === "CONFIRMED"
    ? '<span class="badge badge-confirmed">Confirmed</span>'
    : '<span class="badge badge-cancelled">Cancelled</span>';
}

function bookingRow(db: DatabaseSync, booking: BookingWithNames, isAdmin: boolean): string {
  const service = serviceById(booking.service_id);
  const actions: string[] = [];
  if (booking.status === "CONFIRMED") {
    actions.push(`<a href="/bookings/${esc(booking.ref)}/reschedule">Reschedule</a>`);
    actions.push(
      isAdmin
        ? `<a href="/admin/bookings/${esc(booking.ref)}/cancel">Cancel</a>`
        : `<a href="/bookings/${esc(booking.ref)}/cancel">Cancel</a>`,
    );
  }
  return `<tr>
    <td data-label="Reference"><span class="ref-code">${esc(booking.ref)}</span></td>
    <td data-label="When">${esc(describeLocal(booking.start_utc))}</td>
    <td data-label="Service">${esc(service?.name ?? booking.service_id)}</td>
    <td data-label="Stylist">${esc(booking.stylist_name)}</td>
    <td data-label="Status">${statusBadge(booking.status)}</td>
    <td data-label="Actions">${actions.length ? actions.join(" · ") : "—"}</td>
  </tr>`;
}

export function myRoutes(deps: { db: DatabaseSync; outboxDir: string }): Router {
  const router = Router();
  const { db, outboxDir } = deps;

  // Express 5 types params as string | string[]; treat anything but a plain
  // string as missing so odd requests fall through to "not found".
  function refParam(req: { params: Record<string, string | string[]> }): string {
    const value = req.params.ref;
    return typeof value === "string" ? value : "";
  }

  router.get("/bookings", requireRole("customer", "admin"), (req, res) => {
    const bookings = bookingsForCustomer(db, req.user!.id);
    const rows = bookings.map((b) => bookingRow(db, b, req.user!.role === "admin")).join("\n");
    const flashMessage =
      str(req.query.cancelled) === "1"
        ? "Booking cancelled."
        : str(req.query.rescheduled) === "1"
          ? "Booking rescheduled."
          : "";
    const content = `
    <h1>My bookings</h1>
    ${flash(flashMessage)}
    ${bookings.length === 0
      ? `<div class="empty-state"><p><strong>You have no bookings yet.</strong><br>
         When you book an appointment it will appear here with its reference code.</p>
         <p><a class="button" href="/book">Book an appointment</a></p></div>`
      : `<div class="card"><div class="table-wrap"><table class="stacked">
          <thead><tr><th>Reference</th><th>When</th><th>Service</th><th>Stylist</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div></div>`}`;
    res.send(page({ title: "My bookings", user: req.user ?? null, active: "bookings", content }));
  });

  function canSee(user: { id: number; role: string }, booking: BookingWithNames): boolean {
    return user.role === "admin" || booking.customer_id === user.id;
  }

  router.get("/bookings/:ref", requireRole("customer", "admin"), (req, res) => {
    const booking = getBookingWithNames(db, refParam(req));
    if (!booking || !canSee(req.user!, booking)) {
      notFoundPage(res, "We could not find that booking.");
      return;
    }
    const service = serviceById(booking.service_id);
    const bookedFlash = str(req.query.booked) === "1" ? flash("Booking confirmed. Your reference code is below.") : "";
    const errorFlash = str(req.query.error) ? flash(str(req.query.error), "info") : "";

    let cancelSection = "";
    if (booking.status === "CONFIRMED") {
      cancelSection = req.user!.role === "admin"
        ? `<p><a class="button-danger" href="/admin/bookings/${esc(booking.ref)}/cancel">Cancel this booking (admin)</a></p>`
        : `<p><a class="button-danger" href="/bookings/${esc(booking.ref)}/cancel">Cancel this booking</a></p>`;
    }
    const cancelledInfo =
      booking.status === "CANCELLED"
        ? `<p>Cancelled at ${esc(describeLocal(booking.cancelled_at_utc ?? booking.updated_at_utc))}${
            booking.cancelled_reason ? ` — reason: ${esc(booking.cancelled_reason)}` : ""
          }.</p>`
        : "";

    const content = `
    <h1>Booking ${esc(booking.ref)}</h1>
    ${bookedFlash}
    ${errorFlash}
    <div class="card">
      <p>Status: ${statusBadge(booking.status)}</p>
      <p><span class="ref-code">${esc(booking.ref)}</span></p>
      <p>Service: <strong>${esc(service?.name ?? booking.service_id)}</strong> — ${esc(service ? `${service.minutes} minutes, ${formatPrice(service.priceCents)}` : "")}</p>
      <p>Stylist: <strong>${esc(booking.stylist_name)}</strong></p>
      <p>Customer: ${esc(booking.customer_name)} (${esc(booking.customer_email)})</p>
      <p>Starts: <strong>${esc(describeLocal(booking.start_utc))}</strong> (salon time, America/Chicago)</p>
      <p>Ends: ${esc(describeLocal(booking.end_utc))} (salon time)</p>
      <p>Starts (UTC): <span class="ref-code">${esc(booking.start_utc)}</span></p>
      ${cancelledInfo}
    </div>
    ${cancelSection}
    <p><a href="/bookings">Back to my bookings</a></p>`;
    res.send(page({ title: `Booking ${booking.ref}`, user: req.user ?? null, active: "bookings", content }));
  });

  router.get("/bookings/:ref/cancel", requireRole("customer"), (req, res) => {
    const booking = getBookingWithNames(db, refParam(req));
    if (!booking || booking.customer_id !== req.user!.id) {
      notFoundPage(res, "We could not find that booking.");
      return;
    }
    res.send(page({ title: `Cancel ${booking.ref}`, user: req.user ?? null, active: "bookings", content: cancelConfirm(booking, "") }));
  });

  router.post("/bookings/:ref/cancel", requireRole("customer"), (req, res) => {
    const booking = getBookingWithNames(db, refParam(req));
    if (!booking || booking.customer_id !== req.user!.id) {
      notFoundPage(res, "We could not find that booking.");
      return;
    }
    const result = cancelBooking(db, booking.ref, req.user!, { force: false });
    if (!result.ok) {
      res.status(409).send(page({ title: `Cancel ${booking.ref}`, user: req.user ?? null, active: "bookings", content: cancelConfirm(booking, result.error) }));
      return;
    }
    const fresh = getBookingWithNames(db, booking.ref) ?? booking;
    writeCancellationEmail(outboxDir, fresh, req.user!.role);
    res.redirect(303, `/bookings/${booking.ref}?cancelled=1`);
  });

  router.get("/bookings/:ref/reschedule", requireRole("customer", "admin"), (req, res) => {
    const booking = getBookingWithNames(db, refParam(req));
    if (!booking || !canSee(req.user!, booking)) {
      notFoundPage(res, "We could not find that booking.");
      return;
    }
    if (booking.status !== "CONFIRMED") {
      res.redirect(303, `/bookings/${booking.ref}?error=${encodeURIComponent("Cancelled bookings cannot be rescheduled.")}`);
      return;
    }
    const date = str(req.query.date);
    res.send(page({
      title: `Reschedule ${booking.ref}`,
      user: req.user ?? null,
      active: "bookings",
      content: reschedulePage(db, booking, date, []),
    }));
  });

  router.post("/bookings/:ref/reschedule", requireRole("customer", "admin"), (req, res) => {
    const booking = getBookingWithNames(db, refParam(req));
    if (!booking || !canSee(req.user!, booking)) {
      notFoundPage(res, "We could not find that booking.");
      return;
    }
    const body = req.body ?? {};
    const date = str(body.date);
    const start = str(body.start);
    const startMatch = /^(\d{2}):(\d{2})$/.exec(start);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !startMatch) {
      res.status(400).send(page({
        title: `Reschedule ${booking.ref}`,
        user: req.user ?? null,
        active: "bookings",
        content: reschedulePage(db, booking, date, ["Choose a new date and a start time from the offered slots."]),
      }));
      return;
    }
    const startMinute = Number(startMatch[1]) * 60 + Number(startMatch[2]);
    const result = rescheduleBooking(db, booking.ref, req.user!, { date, startMinute });
    if (!result.ok) {
      res.status(409).send(page({
        title: `Reschedule ${booking.ref}`,
        user: req.user ?? null,
        active: "bookings",
        content: reschedulePage(db, booking, date, [result.error]),
      }));
      return;
    }
    res.redirect(303, `/bookings/${booking.ref}?rescheduled=1`);
  });

  return router;
}

function cancelConfirm(booking: BookingWithNames, error: string): string {
  const service = serviceById(booking.service_id);
  return `
  <h1>Cancel booking ${esc(booking.ref)}</h1>
  ${errorSummary(error ? [error] : [])}
  <div class="card">
    <p>${esc(service?.name ?? booking.service_id)} with ${esc(booking.stylist_name)}</p>
    <p>Starts: <strong>${esc(describeLocal(booking.start_utc))}</strong> (salon time)</p>
    <p class="hint">Customers can cancel up to 24 hours before the start time. Later cancellations must go through the salon.</p>
  </div>
  <form method="post" action="/bookings/${esc(booking.ref)}/cancel">
    ${buttonRow("Yes, cancel this booking", `/bookings/${esc(booking.ref)}`)}
  </form>`;
}

function reschedulePage(
  db: DatabaseSync,
  booking: BookingWithNames,
  date: string,
  errors: string[],
): string {
  const now = clockNow();
  const service = serviceById(booking.service_id)!;
  const minDate = DateTime.now().setZone(SALON_TZ).plus({ minutes: 120 }).toISODate() ?? "";
  const maxDate = DateTime.fromMillis(now.getTime() + MAX_AHEAD_DAYS * 24 * 3600_000).setZone(SALON_TZ).toISODate() ?? "";

  let slotsSection = "";
  let empty = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && errors.length === 0) {
    const slots = slotChoices(db, {
      service,
      stylistId: booking.stylist_id,
      date,
      now,
      excludeBookingId: booking.id,
    });
    if (slots.length === 0) {
      empty = `<div class="empty-state"><p><strong>No free slots with ${esc(booking.stylist_name)} on that date.</strong><br>Try another day.</p></div>`;
    } else {
      const radios = slots
        .map((slot) => `<label class="choice"><input type="radio" name="start" value="${slot.label}" required>
          <span>${esc(minutesToLabel12(labelToMinutes(slot.label)))}</span></label>`)
        .join("\n");
      slotsSection = `
      <form method="post" action="/bookings/${esc(booking.ref)}/reschedule" class="card">
        <input type="hidden" name="date" value="${esc(date)}">
        <fieldset><legend>Pick a new start time</legend><div class="slot-grid">${radios}</div></fieldset>
        ${buttonRow("Reschedule booking")}
      </form>`;
    }
  }

  return `
  <h1>Reschedule booking ${esc(booking.ref)}</h1>
  <p class="hint">The reference code stays the same. The 24-hour rule applies to the <strong>original</strong> appointment time; the new time must follow all booking rules.</p>
  ${errorSummary(errors)}
  ${empty}
  <form method="get" action="/bookings/${esc(booking.ref)}/reschedule" class="card">
    <p><strong>Current:</strong> ${esc(describeLocal(booking.start_utc))} — ${esc(service.name)} with ${esc(booking.stylist_name)}</p>
    ${textField({ name: "date", label: "New date", type: "date", value: date, required: true, attrs: `min="${minDate}" max="${maxDate}"` })}
    ${buttonRow("Show available times")}
  </form>
  ${slotsSection}
  <p><a href="/bookings/${esc(booking.ref)}">Back to the booking</a></p>`;
}

export function writeCancellationEmail(
  outboxDir: string,
  booking: BookingWithNames,
  cancelledByRole: string,
): void {
  try {
    writeOutboxEmail(
      outboxDir,
      "cancellation",
      {
        ref: booking.ref,
        customerEmail: booking.customer_email,
        stylistId: booking.stylist_id,
        serviceId: booking.service_id,
        startUtc: booking.start_utc,
        endUtc: booking.end_utc,
      },
      {
        cancelledBy: cancelledByRole,
        reason: booking.cancelled_reason ?? undefined,
      },
    );
  } catch (err) {
    console.error("[outbox] failed to write cancellation email:", err);
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
