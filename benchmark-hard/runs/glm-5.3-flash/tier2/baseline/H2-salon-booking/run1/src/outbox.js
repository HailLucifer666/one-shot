'use strict';

/**
 * Fake email: readable .txt files written into the outbox/ folder.
 * One file per confirmation / cancellation / reschedule notice.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const time = require('./time');

function priceDisplay(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function renderEmail(kind, d) {
  const when = `${time.localLong(d.startUtc)} - ${time.localTime(d.endUtc)} (${config.SALON_TZ})`;
  const lines = [];
  if (kind === 'confirmation') {
    lines.push('CUTWELL SALON - BOOKING CONFIRMATION', '');
    lines.push(`To:      ${d.customerEmail}`);
    lines.push(`Booking: ${d.ref}`, '');
    lines.push('Your appointment is confirmed.');
  } else if (kind === 'cancellation') {
    lines.push('CUTWELL SALON - BOOKING CANCELLATION', '');
    lines.push(`To:      ${d.customerEmail}`);
    lines.push(`Booking: ${d.ref}`, '');
    lines.push(`Your appointment on ${when} has been cancelled.`);
    lines.push(`Cancelled by: ${d.cancelledByLabel}`);
    if (d.reason) lines.push(`Reason: ${d.reason}`);
  } else {
    lines.push('CUTWELL SALON - BOOKING RESCHEDULED', '');
    lines.push(`To:      ${d.customerEmail}`);
    lines.push(`Booking: ${d.ref}`, '');
    lines.push(`Old time: ${time.localLong(d.oldStartUtc)} - ${time.localTime(d.oldEndUtc)}`);
    lines.push(`New time: ${when}`);
    lines.push('The booking reference stays the same.');
  }
  lines.push(
    '',
    'Service: ' + d.serviceName + ' (' + d.durationMinutes + ' minutes, ' + priceDisplay(d.priceCents) + ')',
    'Stylist: ' + d.stylistName,
    'When:    ' + when,
    'Status:  ' + d.status,
    '',
    `Written at: ${config.nowIso()} (clock override ${process.env.APP_NOW ? 'ACTIVE' : 'off'})`,
    ''
  );
  return lines.join('\n');
}

/**
 * @returns {string} path of the file that was written
 */
function writeOutbox(ctx, kind, data) {
  const dir = ctx.outboxDir;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = config.nowUtc().toFormat("yyyyLLdd'T'HHmmss'Z'");
  const salt = crypto.randomBytes(3).toString('hex');
  const file = path.join(dir, `${stamp}-${kind}-${data.ref}-${salt}.txt`);
  fs.writeFileSync(file, renderEmail(kind, data), 'utf8');
  return file;
}

module.exports = { writeOutbox, priceDisplay };
