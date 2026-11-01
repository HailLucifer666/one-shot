'use strict';

/**
 * Stylist route: read-only view of the stylist's own schedule.
 * There are deliberately no write endpoints for stylists.
 */

const express = require('express');
const { requireRole } = require('../http');
const { bookingToJson } = require('../bookings');

function createStylistRouter(ctx) {
  const router = express.Router();

  router.get('/stylist/schedule', requireRole('stylist'), (req, res) => {
    const stylist = ctx.db
      .prepare('SELECT * FROM stylists WHERE user_id = ?')
      .get(req.user.id);
    if (!stylist) {
      return res.status(404).json({ error: 'No stylist profile is linked to this account.' });
    }
    const rows = ctx.db
      .prepare(
        `SELECT * FROM bookings WHERE stylist_id = ? ORDER BY start_utc`
      )
      .all(stylist.id);
    res.json({
      stylist: { id: stylist.id, name: stylist.name },
      // The viewer is the stylist (not the customer, not admin) - customer
      // email is included so the stylist knows who is coming.
      bookings: rows.map((r) => bookingToJson(ctx, r, req.user)),
    });
  });

  return router;
}

module.exports = { createStylistRouter };
