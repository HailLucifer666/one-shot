'use strict';

/**
 * Audit log: one row per create / cancel / reschedule with who, what, when,
 * before and after (JSON snapshots of the booking). Admin-only to read.
 */

const config = require('./config');
const time = require('./time');

function writeAudit(ctx, { actor, action, bookingRef, before, after }) {
  ctx.db
    .prepare(
      `INSERT INTO audit_log
         (at_utc, actor_user_id, actor_email, actor_role, action, booking_ref, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      config.nowIso(),
      actor ? actor.id : null,
      actor ? actor.email : 'system',
      actor ? actor.role : 'system',
      action,
      bookingRef,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after)
    );
}

function listAudit(db, limit = 500) {
  const rows = db
    .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(limit);
  return rows.map((r) => ({
    id: r.id,
    at_utc: r.at_utc,
    at_local: time.localDateTime(r.at_utc),
    actor_email: r.actor_email,
    actor_role: r.actor_role,
    action: r.action,
    booking_ref: r.booking_ref,
    before: r.before_json ? JSON.parse(r.before_json) : null,
    after: r.after_json ? JSON.parse(r.after_json) : null,
  }));
}

module.exports = { writeAudit, listAudit };
