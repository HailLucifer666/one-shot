'use strict';

/**
 * Admin routes:
 *   GET /api/admin/bookings      20 per page, filters date + stylist + status
 *                                (all combined), each booking with local times
 *   GET /api/admin/bookings/csv  CSV of the NEXT 7 DAYS from the current
 *                                (possibly overridden) time: [now, now+7d)
 *   GET /api/admin/audit         full audit log, newest first
 */

const express = require('express');
const config = require('../config');
const { DateTime } = require('luxon');
const { bookingToJson } = require('../bookings');
const { listAudit } = require('../audit');
const { requireRole } = require('../http');

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function createAdminRouter(ctx) {
  const router = express.Router();
  router.use(requireRole('admin'));

  router.get('/bookings', (req, res) => {
    const db = ctx.db;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const where = [];
    const params = [];

    if (req.query.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date))) {
        return res.status(400).json({ error: 'The "date" filter must be YYYY-MM-DD (salon local date).' });
      }
      where.push('b.start_local_date = ?');
      params.push(req.query.date);
    }
    if (req.query.stylistId) {
      const sid = Number.parseInt(req.query.stylistId, 10);
      if (Number.isNaN(sid)) return res.status(400).json({ error: 'The "stylistId" filter must be a number.' });
      where.push('b.stylist_id = ?');
      params.push(sid);
    }
    if (req.query.status) {
      const status = String(req.query.status);
      if (!['confirmed', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'The "status" filter must be "confirmed" or "cancelled".' });
      }
      where.push('b.status = ?');
      params.push(status);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM bookings b ${whereSql}`).get(...params).n;
    const totalPages = Math.max(1, Math.ceil(total / config.PAGE_SIZE));
    const rows = db
      .prepare(
        `SELECT b.* FROM bookings b ${whereSql}
         ORDER BY b.start_utc, b.id
         LIMIT ? OFFSET ?`
      )
      .all(...params, config.PAGE_SIZE, (page - 1) * config.PAGE_SIZE);

    res.json({
      bookings: rows.map((r) => bookingToJson(ctx, r, req.user)),
      page,
      page_size: config.PAGE_SIZE,
      total,
      total_pages: totalPages,
    });
  });

  router.get('/bookings/csv', (req, res) => {
    const now = config.nowUtc();
    const startIso = config.fmtUtc(now);
    const endIso = config.fmtUtc(now.plus({ days: 7 }));
    const rows = ctx.db
      .prepare(
        `SELECT b.ref, b.start_local_date, b.start_local_time, b.end_local_date, b.end_local_time,
                s.name AS service_name, st.name AS stylist_name, u.email AS customer_email, b.status
         FROM bookings b
         JOIN services s ON s.id = b.service_id
         JOIN stylists st ON st.id = b.stylist_id
         JOIN users u ON u.id = b.customer_id
         WHERE b.start_utc >= ? AND b.start_utc < ?
         ORDER BY b.start_utc, b.id`
      )
      .all(startIso, endIso);

    const header = ['ref', 'start', 'end', 'service', 'stylist', 'customer_email', 'status'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.ref,
          `${r.start_local_date} ${r.start_local_time}`,
          `${r.end_local_date} ${r.end_local_time}`,
          r.service_name,
          r.stylist_name,
          r.customer_email,
          r.status,
        ]
          .map(csvEscape)
          .join(',')
      );
    }
    // CRLF line endings so the file opens cleanly in spreadsheets.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cutwell-bookings-next-7-days.csv"`
    );
    res.send(lines.join('\r\n') + '\r\n');
  });

  router.get('/audit', (req, res) => {
    res.json({ entries: listAudit(ctx.db) });
  });

  return router;
}

module.exports = { createAdminRouter, csvEscape };
