import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatLocal, formatPrice, serviceById, stylistById } from "./salon.ts";

export type EmailBooking = {
  ref: string;
  customerEmail: string;
  stylistId: number;
  serviceId: string;
  startUtc: string;
  endUtc: string;
};

/**
 * Writes a plain-text email into the outbox folder instead of sending it.
 * Confirmation -> <ref>-confirmation.txt, cancellation -> <ref>-cancellation.txt.
 * A failed write is logged but does not fail the booking action.
 */
export function writeOutboxEmail(
  outboxDir: string,
  kind: "confirmation" | "cancellation",
  booking: EmailBooking,
  extra: { cancelledBy?: string; reason?: string } = {},
): string {
  const service = serviceById(booking.serviceId);
  const stylist = stylistById(booking.stylistId);
  const serviceName = service ? `${service.name} (${service.minutes} minutes, ${formatPrice(service.priceCents)})` : booking.serviceId;
  const stylistName = stylist?.name ?? String(booking.stylistId);

  const lines: string[] = [
    `CUTWELL SALON — ${kind.toUpperCase()}`,
    "",
    `Booking reference: ${booking.ref}`,
    `Service:           ${serviceName}`,
    `Stylist:           ${stylistName}`,
    `Starts:            ${formatLocal(booking.startUtc, "cccc yyyy-MM-dd, h:mm a")} (salon time, America/Chicago)`,
    `Ends:              ${formatLocal(booking.endUtc, "cccc yyyy-MM-dd, h:mm a")} (salon time, America/Chicago)`,
    `Starts (UTC):      ${booking.startUtc}`,
    `Customer:          ${booking.customerEmail}`,
  ];

  if (kind === "confirmation") {
    lines.push(
      "",
      "We look forward to seeing you! Sign in to view, reschedule or cancel",
      "this appointment. Customers can cancel up to 24 hours before the start.",
    );
  } else {
    lines.push("", `Cancelled by:      ${extra.cancelledBy ?? "customer"}`);
    if (extra.reason) lines.push(`Reason:            ${extra.reason}`);
    lines.push("", "This appointment has been cancelled and the time is free again.");
  }

  lines.push("", "---", "Demo email written to the outbox folder; no real email was sent.", "");

  mkdirSync(outboxDir, { recursive: true });
  const path = join(outboxDir, `${booking.ref}-${kind}.txt`);
  writeFileSync(path, lines.join("\n"), "utf8");
  return path;
}
