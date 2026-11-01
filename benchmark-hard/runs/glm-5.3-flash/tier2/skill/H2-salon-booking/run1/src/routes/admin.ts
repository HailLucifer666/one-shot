import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import {
  STYLISTS,
  formatLocal,
  serviceById,
} from "../salon.ts";
import { describeLocal } from "../slots.ts";
import { cancelBooking, getBookingWithNames, type BookingWithNames } from "../bookings.ts";
import { requireRole } from "../middleware.ts";
import { buttonRow, errorSummary, esc, flash, page } from "../render.ts";
import { toCsv } from "../csv.ts";
import { writeCancellationEmail } from "./my.ts";
import { now as clockNow } from "../clock.ts";

const PAGE_SIZE = 20;

type ListFilters = { date: string; stylist: string; status: string };

function buildWhere(filters: ListFilters): { where: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(filters.date)) {
    clauses.push("b.local_date = ?");
    params.push(filters.date);
  }
  if (/^\d+$/.test(filters.stylist)) {
    clauses.push("b.stylist_id = ?");
    params.push(Number(filters.stylist));
  }
  if (filters.status === "CONFIRMED" || filters.status === "CANCELLED") {
    clauses.push("b.status = ?");
    params.push(filters.status);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function listRows(bookings: BookingWithNames[]): string {
  return bookings
    .map(
      (b) => `<tr>
    <td data-label="Reference"><span class="ref-code">${esc(b.ref)}</span></td>
    <td data-label="Start">${esc(formatLocal(b.start_utc, "yyyy-MM-dd h:mm a"))}</td>
    <td data-label="End">${esc(formatLocal(b.end_utc, "yyyy-MM-dd h:mm a"))}</td>
    <td data-label="Service">${esc(serviceById(b.service_id)?.name ?? b.service_id)}</td>
    <td data-label="Stylist">${esc(b.stylist_name)}</td>
    <td data-label="Customer">${esc(b.customer_email)}</td>
    <td data-label="Status">${b.status === "CONFIRMED" ? '<span class="badge badge-confirmed">Confirmed</span>' : '<span class="badge badge-cancelled">Cancelled</span>'}</td>
    <td data-label="Actions"><a href="/admin/bookings/${esc(b.ref)}/cancel">Cancel</a></td>
  </tr>`,
    )
    .join("\n");
}

function filterForm(filters: ListFilters): string {
  const stylistOptions = ['<option value="">Any stylist</option>']
    .concat(
      STYLISTS.map(
        (s) => `<option value="${s.id}"${filters.stylist === String(s.id) ? " selected" : ""}>${esc(s.name)}</option>`,
      ),
    )
    .join("");
  const statusOptions = ['<option value="">Any status</option>']
    .concat(
      ["CONFIRMED", "CANCELLED"].map(
        (s) => `<option value="${s}"${filters.status === s ? " selected" : ""}>${s === "CONFIRMED" ? "Confirmed" : "Cancelled"}</option>`,
      ),
    )
    .join("");
  return `
  <form method="get" action="/admin/bookings" class="card">
    <div class="filters">
      <div class="field">
        <label for="filter-date">Date</label>
        <input id="filter-date" name="date" type="date" value="${esc(filters.date)}">
      </div>
      <div class="field">
        <label for="filter-stylist">Stylist</label>
        <select id="filter-stylist" name="stylist">${stylistOptions}</select>
      </div>
      <div class="field">
        <label for="filter-status">Status</label>
        <select id="filter-status" name="status">${statusOptions}</select>
      </div>
      <div class="field">
        <button type="submit" class="button">Apply filters</button>
      </div>
      <div class="field">
        <a class="button-secondary" href="/admin/bookings">Clear</a>
      </div>
    </div>
  </form>`;
}

export function adminRoutes(deps: { db: DatabaseSync; outboxDir: string }): Router {
  const router = Router();
  const { db, outboxDir } = deps;

  const listQuery = `
    SELECT b.*, u.email AS customer_email, u.name AS customer_name, s.name AS stylist_name
    FROM bookings b
    JOIN users u ON u.id = b.customer_id
    JOIN stylists s ON s.id = b.stylist_id`;

  router.get("/admin/bookings", requireRole("admin"), (req, res) => {
    const filters: ListFilters = {
      date: typeof req.query.date === "string" ? req.query.date : "",
      stylist: typeof req.query.stylist === "string" ? req.query.stylist : "",
      status: typeof req.query.status === "string" ? req.query.status : "",
    };
    const { where, params } = buildWhere(filters);
    const pageNum = Math.max(1, Number(req.query.page ?? "1") || 1);
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM bookings b ${where}`).get(...params) as { n: number }).n;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rows = db
      .prepare(`${listQuery} ${where} ORDER BY b.start_utc ASC, b.id ASC LIMIT ? OFFSET ?`)
      .all(...params, PAGE_SIZE, (pageNum - 1) * PAGE_SIZE) as unknown as BookingWithNames[];

    const keep = new URLSearchParams();
    if (filters.date) keep.set("date", filters.date);
    if (filters.stylist) keep.set("stylist", filters.stylist);
    if (filters.status) keep.set("status", filters.status);
    const qs = keep.toString();
    const pageLink = (p: number) => `/admin/bookings?${qs ? `${qs}&` : ""}page=${p}`;

    const content = `
    <h1>All bookings</h1>
    ${flash(str(req.query.cancelled) === "1" ? "Booking cancelled." : "")}
    <p><a href="/admin/bookings/export.csv">Download CSV for the next 7 days</a> · <a href="/admin/audit">Audit log</a></p>
    ${filterForm(filters)}
    ${total === 0
      ? `<div class="empty-state"><p><strong>No bookings match.</strong><br>Adjust or clear the filters${qs ? "" : " — there are no bookings yet" }.</p></div>`
      : `<div class="card"><div class="table-wrap"><table class="stacked">
          <thead><tr><th>Reference</th><th>Start</th><th>End</th><th>Service</th><th>Stylist</th><th>Customer</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${listRows(rows)}</tbody>
        </table></div>
        <div class="pagination">
          <a href="${pageLink(Math.max(1, pageNum - 1))}"${pageNum <= 1 ? ' aria-disabled="true"' : ""}>Previous</a>
          <span>Page ${pageNum} of ${totalPages} · ${total} booking${total === 1 ? "" : "s"}</span>
          <a href="${pageLink(Math.min(totalPages, pageNum + 1))}"${pageNum >= totalPages ? ' aria-disabled="true"' : ""}>Next</a>
        </div></div>`}`;
    res.send(page({ title: "All bookings", user: req.user ?? null, active: "admin", content }));
  });

  // CSV export: exactly the next 7 days, local times (criterion 19).
  router.get("/admin/bookings/export.csv", requireRole("admin"), (_req, res) => {
    const now = clockNow();
    const to = new Date(now.getTime() + 7 * 24 * 3600_000);
    const rows = db
      .prepare(
        `${listQuery} WHERE b.start_utc >= ? AND b.start_utc < ? ORDER BY b.start_utc ASC, b.id ASC`,
      )
      .all(now.toISOString(), to.toISOString()) as unknown as BookingWithNames[];
    const csv = toCsv(
      ["ref", "start", "end", "service", "stylist", "customer_email", "status"],
      rows.map((b) => [
        b.ref,
        formatLocal(b.start_utc, "yyyy-MM-dd HH:mm"),
        formatLocal(b.end_utc, "yyyy-MM-dd HH:mm"),
        serviceById(b.service_id)?.name ?? b.service_id,
        b.stylist_name,
        b.customer_email,
        b.status,
      ]),
    );
    res.set("content-type", "text/csv; charset=utf-8");
    res.set("content-disposition", 'attachment; filename="cutwell-next-7-days.csv"');
    res.send(csv);
  });

  router.get("/admin/bookings/:ref/cancel", requireRole("admin"), (req, res) => {
    const booking = getBookingWithNames(db, refParam(req));
    if (!booking) {
      res.status(404).send(notFound("We could not find that booking."));
      return;
    }
    res.send(
      page({
        title: `Cancel ${booking.ref}`,
        user: req.user ?? null,
        active: "admin",
        content: adminCancelForm(booking, ""),
      }),
    );
  });

  router.post("/admin/bookings/:ref/cancel", requireRole("admin"), (req, res) => {
    const booking = getBookingWithNames(db, refParam(req));
    if (!booking) {
      res.status(404).send(notFound("We could not find that booking."));
      return;
    }
    const reason = typeof (req.body ?? {}).reason === "string" ? (req.body as { reason: string }).reason : "";
    if (reason.trim().length === 0) {
      res.status(400).send(page({
        title: `Cancel ${booking.ref}`,
        user: req.user ?? null,
        active: "admin",
        content: adminCancelForm(booking, "A cancellation reason is required."),
      }));
      return;
    }
    const result = cancelBooking(db, booking.ref, req.user!, { force: true, reason });
    if (!result.ok) {
      res.status(409).send(page({
        title: `Cancel ${booking.ref}`,
        user: req.user ?? null,
        active: "admin",
        content: adminCancelForm(booking, result.error),
      }));
      return;
    }
    const fresh = getBookingWithNames(db, booking.ref) ?? booking;
    writeCancellationEmail(outboxDir, fresh, "admin");
    res.redirect(303, `/bookings/${booking.ref}?cancelled=1`);
  });

  router.get("/admin/audit", requireRole("admin"), (req, res) => {
    const pageNum = Math.max(1, Number(req.query.page ?? "1") || 1);
    const total = (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rows = db
      .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?")
      .all(PAGE_SIZE, (pageNum - 1) * PAGE_SIZE) as unknown as Array<{
      at_utc: string;
      actor_email: string;
      actor_role: string;
      action: string;
      booking_ref: string;
      before_json: string | null;
      after_json: string | null;
      details: string | null;
    }>;

    const entries = rows
      .map((row) => {
        const before = row.before_json ? `<pre class="audit-json">${esc(pretty(row.before_json))}</pre>` : "<p>—</p>";
        const after = row.after_json ? `<pre class="audit-json">${esc(pretty(row.after_json))}</pre>` : "<p>—</p>";
        return `<tr>
      <td data-label="When">${esc(formatLocal(row.at_utc, "yyyy-MM-dd HH:mm:ss"))}</td>
      <td data-label="Who">${esc(row.actor_email)} (${esc(row.actor_role)})</td>
      <td data-label="Action">${esc(row.action)}</td>
      <td data-label="Booking"><span class="ref-code">${esc(row.booking_ref)}</span></td>
      <td data-label="Before">${before}</td>
      <td data-label="After">${after}</td>
      <td data-label="Notes">${esc(row.details ?? "")}</td>
    </tr>`;
      })
      .join("\n");

    const content = `
    <h1>Audit log</h1>
    <p class="hint">Every create, cancel and reschedule, with who did it, when, and the state before and after. ${total} entries.</p>
    ${total === 0
      ? `<div class="empty-state"><p><strong>No audit entries yet.</strong><br>Entries appear as soon as bookings are created, cancelled or rescheduled.</p></div>`
      : `<div class="card"><div class="table-wrap"><table class="stacked">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Booking</th><th>Before</th><th>After</th><th>Notes</th></tr></thead>
          <tbody>${entries}</tbody>
        </table></div>
        <div class="pagination">
          <a href="/admin/audit?page=${Math.max(1, pageNum - 1)}"${pageNum <= 1 ? ' aria-disabled="true"' : ""}>Previous</a>
          <span>Page ${pageNum} of ${totalPages}</span>
          <a href="/admin/audit?page=${Math.min(totalPages, pageNum + 1)}"${pageNum >= totalPages ? ' aria-disabled="true"' : ""}>Next</a>
        </div></div>`}
    <p><a href="/admin/bookings">Back to all bookings</a></p>`;
    res.send(page({ title: "Audit log", user: req.user ?? null, active: "admin", content }));
  });

  return router;
}

function adminCancelForm(booking: BookingWithNames, error: string): string {
  const service = serviceById(booking.service_id);
  return `
  <h1>Cancel booking ${esc(booking.ref)} (admin)</h1>
  ${errorSummary(error ? [error] : [])}
  <div class="card">
    <p>${esc(service?.name ?? booking.service_id)} with ${esc(booking.stylist_name)}</p>
    <p>Customer: ${esc(booking.customer_name)} (${esc(booking.customer_email)})</p>
    <p>Starts: <strong>${esc(describeLocal(booking.start_utc))}</strong> (salon time)</p>
    <p class="hint">Admins can cancel any booking at any time. A written reason is required and is stored in the audit log and the cancellation email.</p>
  </div>
  <form method="post" action="/admin/bookings/${esc(booking.ref)}/cancel">
    <div class="field">
      <label for="field-reason">Cancellation reason</label>
      <textarea id="field-reason" name="reason" rows="3" required placeholder="e.g. stylist unwell, salon closed for maintenance">${""}</textarea>
    </div>
    ${buttonRow("Cancel this booking", `/bookings/${esc(booking.ref)}`)}
  </form>`;
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 1);
  } catch {
    return json;
  }
}

function notFound(message: string): string {
  return page({
    title: "Not found",
    user: null,
    content: `<h1>Not found</h1><p>${esc(message)}</p><p><a class="button-secondary" href="/admin/bookings">Back to all bookings</a></p>`,
  });
}

function refParam(req: { params: Record<string, string | string[]> }): string {
  const value = req.params.ref;
  return typeof value === "string" ? value : "";
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
