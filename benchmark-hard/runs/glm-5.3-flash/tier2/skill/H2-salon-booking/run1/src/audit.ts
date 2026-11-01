import type { DatabaseSync } from "node:sqlite";
import type { SessionUser } from "./auth.ts";

export type AuditAction = "CREATE" | "CANCEL" | "RESCHEDULE";

export type AuditEntry = {
  actor: SessionUser;
  action: AuditAction;
  bookingRef: string;
  before: unknown;
  after: unknown;
  details?: string;
};

/** Records who did what, when, with before/after snapshots. */
export function writeAudit(db: DatabaseSync, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_log (at_utc, actor_user_id, actor_email, actor_role, action, booking_ref, before_json, after_json, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    new Date().toISOString(),
    entry.actor.id,
    entry.actor.email,
    entry.actor.role,
    entry.action,
    entry.bookingRef,
    entry.before == null ? null : JSON.stringify(entry.before),
    entry.after == null ? null : JSON.stringify(entry.after),
    entry.details ?? null,
  );
}

/** Compact booking snapshot for audit before/after JSON. */
export function bookingSnapshot(booking: {
  ref: string;
  customer_id: number;
  stylist_id: number;
  service_id: string;
  start_utc: string;
  end_utc: string;
  status: string;
  cancelled_reason?: string | null;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ref: booking.ref,
    customer_id: booking.customer_id,
    stylist_id: booking.stylist_id,
    service_id: booking.service_id,
    start_utc: booking.start_utc,
    end_utc: booking.end_utc,
    status: booking.status,
  };
  if (booking.cancelled_reason !== undefined) out.cancelled_reason = booking.cancelled_reason;
  return out;
}
