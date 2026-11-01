'use strict';

/**
 * Public catalog + availability endpoints:
 *   GET /api/services, /api/stylists, /api/availability, /api/meta, /api/now
 */

const express = require('express');
const config = require('../config');
const { getAvailability } = require('../availability');
const { scheduleText } = require('../schedules');

function createCatalogRouter(ctx) {
  const router = express.Router();
  const db = ctx.db;

  router.get('/services', (req, res) => {
    const rows = db.prepare('SELECT * FROM services ORDER BY id').all();
    res.json({
      services: rows.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        duration_minutes: s.duration_minutes,
        price_cents: s.price_cents,
        price_display: `$${(s.price_cents / 100).toFixed(2)}`,
      })),
    });
  });

  router.get('/stylists', (req, res) => {
    const rows = db.prepare('SELECT * FROM stylists ORDER BY id').all();
    res.json({
      stylists: rows.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        schedule_text: scheduleText(s),
      })),
    });
  });

  router.get('/availability', (req, res) => {
    const serviceId = Number.parseInt(req.query.serviceId, 10);
    if (Number.isNaN(serviceId)) {
      const err = new Error('The "serviceId" parameter must be a number.');
      err.status = 400;
      throw err;
    }
    const stylistIdRaw = req.query.stylistId;
    let stylistId;
    if (stylistIdRaw === 'any' || stylistIdRaw == null || stylistIdRaw === '') {
      stylistId = 'any';
    } else {
      stylistId = Number.parseInt(stylistIdRaw, 10);
      if (Number.isNaN(stylistId)) {
        const err = new Error('The "stylistId" parameter must be a number or "any".');
        err.status = 400;
        throw err;
      }
    }
    const result = getAvailability(db, {
      serviceId,
      stylistId,
      dateStr: req.query.date,
    });
    res.json(result);
  });

  // Small config payload so the UI can bound its date picker correctly.
  router.get('/meta', (req, res) => {
    const now = config.nowUtc();
    const today = now.setZone(config.SALON_TZ);
    res.json({
      salon_name: 'Cutwell Salon',
      salon_timezone: config.SALON_TZ,
      now_utc: config.fmtUtc(now),
      now_local_date: today.toFormat('yyyy-MM-dd'),
      min_date: today.toFormat('yyyy-MM-dd'),
      max_date: today.plus({ days: config.MAX_HORIZON_DAYS }).toFormat('yyyy-MM-dd'),
      clock_override: Boolean(process.env.APP_NOW),
    });
  });

  // Diagnostics for the documented clock override (see README).
  router.get('/now', (req, res) => {
    const now = config.nowUtc();
    res.json({
      now_utc: config.fmtUtc(now),
      now_local: now.setZone(config.SALON_TZ).toFormat('yyyy-MM-dd HH:mm'),
      clock_override: Boolean(process.env.APP_NOW),
      app_now_raw: process.env.APP_NOW || null,
    });
  });

  return router;
}

module.exports = { createCatalogRouter };
