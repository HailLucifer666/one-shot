import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import {
  MAX_AHEAD_DAYS,
  SALON_TZ,
  SERVICES,
  STYLISTS,
  formatPrice,
  minutesToLabel12,
  stylistById,
  type Service,
} from "../salon.ts";
import { availableSlots, anyStylistSlots, type Slot } from "../slots.ts";
import {
  activeBookingsForDate,
  activeBookingsForDateByStylist,
  createBooking,
  validateBookingInput,
  validateSlotForStylist,
} from "../bookings.ts";
import { now as clockNow } from "../clock.ts";
import { requireRole } from "../middleware.ts";
import { buttonRow, errorSummary, esc, page } from "../render.ts";
import { writeOutboxEmail } from "../email.ts";

export type BookFormValues = {
  service: string;
  stylist: string; // "any" | stylist id as string
  date: string;
  start: string; // "HH:MM" local
};

export type SlotChoice = Slot & { stylistIds: number[] };

/** Bookable start times for a service on a date, for one stylist or any. */
export function slotChoices(
  db: DatabaseSync,
  opts: { service: Service; stylistId: number | null; date: string; now: Date; excludeBookingId?: number },
): SlotChoice[] {
  if (opts.stylistId !== null) {
    return availableSlots({
      service: opts.service,
      stylistId: opts.stylistId,
      date: opts.date,
      now: opts.now,
      activeBookings: activeBookingsForDate(db, opts.stylistId, opts.date, opts.excludeBookingId),
    }).map((slot) => ({ ...slot, stylistIds: [opts.stylistId!] }));
  }
  return anyStylistSlots({
    service: opts.service,
    stylistIds: STYLISTS.map((s) => s.id),
    date: opts.date,
    now: opts.now,
    bookingsByStylist: activeBookingsForDateByStylist(db, opts.date),
  });
}

function serviceRadios(selected: string): string {
  return SERVICES.map((service) => {
    const checked = selected === service.id ? " checked" : "";
    return `<label class="choice"><input type="radio" name="service" value="${service.id}"${checked} required>
      <span>${esc(service.name)} — ${service.minutes} min, ${formatPrice(service.priceCents)}</span></label>`;
  }).join("\n      ");
}

function stylistSelect(selected: string): string {
  const options = [`<option value="any"${selected === "any" || selected === "" ? " selected" : ""}>Any available stylist</option>`]
    .concat(
      STYLISTS.map(
        (s) => `<option value="${s.id}"${selected === String(s.id) ? " selected" : ""}>${esc(s.name)}</option>`,
      ),
    )
    .join("");
  return `<div class="field">
    <label for="field-stylist">Stylist</label>
    <select id="field-stylist" name="stylist">${options}</select>
  </div>`;
}

function dateField(selected: string, min: string, max: string): string {
  return `<div class="field">
    <label for="field-date">Date</label>
    <input id="field-date" name="date" type="date" value="${esc(selected)}" min="${min}" max="${max}" required>
  </div>`;
}

function slotPicker(values: BookFormValues, slots: SlotChoice[]): string {
  const radios = slots
    .map((slot) => {
      const checked = values.start === slot.label ? " checked" : "";
      const who =
        slot.stylistIds.length === 1
          ? ""
          : ` <span class="hint">with ${slot.stylistIds.map((id) => esc(stylistById(id)?.name ?? String(id))).join(" or ")}</span>`;
      return `<label class="choice"><input type="radio" name="start" value="${slot.label}"${checked} required>
        <span>${minutesToLabel12(slot.startMinute)}${who}</span></label>`;
    })
    .join("\n      ");
  return `
  <form method="post" action="/book/preview" class="card">
    <input type="hidden" name="service" value="${esc(values.service)}">
    <input type="hidden" name="stylist" value="${esc(values.stylist)}">
    <input type="hidden" name="date" value="${esc(values.date)}">
    <fieldset>
      <legend>Pick a start time</legend>
      <div class="slot-grid">
      ${radios}
      </div>
    </fieldset>
    ${buttonRow("Continue")}
  </form>`;
}

/**
 * The booking page: choose service + stylist (or any) + date, then pick a
 * slot. Everything is server-rendered; works with the keyboard and without
 * JavaScript.
 */
export function bookingPageContent(
  db: DatabaseSync,
  values: BookFormValues,
  errors: string[],
): string {
  const now = clockNow();
  const minDate = DateTime.now().setZone(SALON_TZ).toISODate() ?? "";
  const maxDate = DateTime.fromMillis(now.getTime() + MAX_AHEAD_DAYS * 24 * 3600_000).setZone(SALON_TZ).toISODate() ?? "";

  const parsed = validateBookingInput({ service: values.service, stylist: values.stylist, date: values.date }, { requireStart: false });
  const allChosen = parsed.ok;
  let slotsSection = "";
  let noSlots = "";
  if (allChosen && !errors.length) {
    const service = SERVICES.find((s) => s.id === parsed.serviceId)!;
    const slots = slotChoices(db, {
      service,
      stylistId: parsed.stylistId,
      date: parsed.date,
      now,
    });
    if (slots.length === 0) {
      noSlots = `<div class="empty-state"><p><strong>No free slots for this day.</strong><br>
        Try another day, another stylist, or a shorter service. Bookings need at least 2 hours' notice and can be up to 60 days ahead.</p></div>`;
    } else {
      slotsSection = slotPicker(values, slots);
    }
  }

  return `
  <h1>Book an appointment</h1>
  <p class="hint">All times are salon time (America/Chicago). Slots start every 15 minutes; bookings need at least 2 hours' notice and can be made up to 60 days ahead.</p>
  ${errorSummary(errors)}
  ${noSlots}
  <form method="get" action="/book" class="card">
    <fieldset>
      <legend>Service</legend>
      ${serviceRadios(values.service)}
    </fieldset>
    ${stylistSelect(values.stylist)}
    ${dateField(values.date, minDate, maxDate)}
    ${buttonRow("Show available times")}
  </form>
  ${slotsSection}`;
}

export function bookRoutes(deps: { db: DatabaseSync; outboxDir: string }): Router {
  const router = Router();
  const { db, outboxDir } = deps;

  router.get("/book", requireRole("customer", "admin"), (req, res) => {
    const values: BookFormValues = {
      service: str(req.query.service),
      stylist: str(req.query.stylist),
      date: str(req.query.date),
      start: "",
    };
    res.send(page({ title: "Book", user: req.user ?? null, active: "book", content: bookingPageContent(db, values, []) }));
  });

  router.post("/book/preview", requireRole("customer", "admin"), (req, res) => {
    const body = req.body ?? {};
    const values: BookFormValues = {
      service: str(body.service),
      stylist: str(body.stylist),
      date: str(body.date),
      start: str(body.start),
    };
    const parsed = validateBookingInput(body);
    if (!parsed.ok) {
      res.status(400).send(
        page({ title: "Book", user: req.user ?? null, active: "book", content: bookingPageContent(db, values, parsed.errors) }),
      );
      return;
    }
    const service = SERVICES.find((s) => s.id === parsed.serviceId)!;
    const now = clockNow();
    let valid = false;
    let conflictMessage = "";
    if (parsed.stylistId !== null) {
      const slot = validateSlotForStylist(db, {
        service,
        stylistId: parsed.stylistId,
        date: parsed.date,
        startMinute: parsed.startMinute,
        now,
      });
      valid = slot.ok;
      if (!slot.ok) conflictMessage = slot.error;
    } else {
      valid = slotChoices(db, { service, stylistId: null, date: parsed.date, now }).some((s) => s.startMinute === parsed.startMinute);
      if (!valid) conflictMessage = "No stylist is free at that time. Please pick another slot.";
    }
    if (!valid) {
      res.status(409).send(
        page({ title: "Book", user: req.user ?? null, active: "book", content: bookingPageContent(db, values, [conflictMessage]) }),
      );
      return;
    }

    const stylistLabel =
      parsed.stylistId !== null
        ? esc(stylistById(parsed.stylistId)?.name ?? String(parsed.stylistId))
        : "First available stylist";
    const startLocal = DateTime.fromISO(`${parsed.date}T${values.start}`, { zone: SALON_TZ });
    const endLocal = startLocal.plus({ minutes: service.minutes });
    res.send(
      page({
        title: "Confirm booking",
        user: req.user ?? null,
        active: "book",
        content: `
        <h1>Confirm your booking</h1>
        <div class="card">
          <p><strong>${esc(service.name)}</strong> — ${service.minutes} minutes, ${formatPrice(service.priceCents)}</p>
          <p>Stylist: <strong>${stylistLabel}</strong></p>
          <p>When: <strong>${esc(startLocal.setZone(SALON_TZ).toFormat("cccc d LLLL yyyy, h:mm a"))}</strong> to
             ${esc(endLocal.setZone(SALON_TZ).toFormat("h:mm a"))} (salon time, America/Chicago)</p>
          <p class="hint">You can cancel for free up to 24 hours before the start time.</p>
        </div>
        <form method="post" action="/book">
          <input type="hidden" name="service" value="${esc(values.service)}">
          <input type="hidden" name="stylist" value="${esc(values.stylist)}">
          <input type="hidden" name="date" value="${esc(values.date)}">
          <input type="hidden" name="start" value="${esc(values.start)}">
          ${buttonRow("Confirm booking")}
          <p><a href="/book?service=${esc(values.service)}&stylist=${esc(values.stylist)}&date=${esc(values.date)}">Pick a different time</a></p>
        </form>`,
      }),
    );
  });

  router.post("/book", requireRole("customer", "admin"), (req, res) => {
    const body = req.body ?? {};
    const values: BookFormValues = {
      service: str(body.service),
      stylist: str(body.stylist),
      date: str(body.date),
      start: str(body.start),
    };
    const parsed = validateBookingInput(body);
    if (!parsed.ok) {
      res.status(400).send(
        page({ title: "Book", user: req.user ?? null, active: "book", content: bookingPageContent(db, values, parsed.errors) }),
      );
      return;
    }
    const result = createBooking(db, {
      customerId: req.user!.id,
      serviceId: parsed.serviceId,
      stylistId: parsed.stylistId,
      date: parsed.date,
      startMinute: parsed.startMinute,
    });
    if (!result.ok) {
      res.status(result.conflict ? 409 : 400).send(
        page({ title: "Book", user: req.user ?? null, active: "book", content: bookingPageContent(db, values, [result.error]) }),
      );
      return;
    }
    try {
      writeOutboxEmail(outboxDir, "confirmation", {
        ref: result.booking.ref,
        customerEmail: req.user!.email,
        stylistId: result.booking.stylist_id,
        serviceId: result.booking.service_id,
        startUtc: result.booking.start_utc,
        endUtc: result.booking.end_utc,
      });
    } catch (err) {
      console.error("[outbox] failed to write confirmation email:", err);
    }
    res.redirect(303, `/bookings/${result.booking.ref}?booked=1`);
  });

  return router;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
