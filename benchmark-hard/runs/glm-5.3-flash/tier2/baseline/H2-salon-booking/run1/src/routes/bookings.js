'use strict';

/**
 * Booking routes. Access matrix:
 *   POST   /api/bookings            customer (role customer) books for self
 *   GET    /api/bookings            customer -> own; admin -> all; stylist -> 403
 *   GET    /api/bookings/:ref       owner or admin only (404 otherwise, so a
 *                                   customer cannot probe other people's refs)
 *   POST   /api/bookings/:ref/cancel     owner (24h rule) or admin (reason)
 *   POST   /api/bookings/:ref/reschedule owner or admin (24h rule + all rules)
 */

const express = require('express');
const {
  HttpError,
  createBooking,
  cancelBooking,
  rescheduleBooking,
  bookingToJson,
  getBookingByRef,
  listBookingsFor,
} = require('../bookings');
const { requireAuth, requireRole } = require('../http');

function createBookingsRouter(ctx) {
  const router = express.Router();

  router.post('/bookings', requireRole('customer'), (req, res) => {
    const body = req.body || {};
    const serviceId = Number.parseInt(body.serviceId, 10);
    if (Number.isNaN(serviceId)) throw new HttpError(422, 'Unknown service.');
    let stylistId;
    if (body.stylistId === 'any' || body.stylistId == null) {
      stylistId = 'any';
    } else {
      stylistId = Number.parseInt(body.stylistId, 10);
      if (Number.isNaN(stylistId)) throw new HttpError(404, 'Unknown stylist.');
    }
    const row = createBooking(ctx, {
      customer: req.user,
      serviceId,
      stylistId,
      startIso: body.start,
    });
    res.status(201).json({ booking: bookingToJson(ctx, row, req.user) });
  });

  router.get('/bookings', requireAuth, (req, res) => {
    if (req.user.role === 'stylist') {
      throw new HttpError(403, 'Stylists can view their own schedule at /api/stylist/schedule.');
    }
    const rows = listBookingsFor(ctx, req.user);
    res.json({ bookings: rows.map((r) => bookingToJson(ctx, r, req.user)) });
  });

  router.get('/bookings/:ref', requireAuth, (req, res) => {
    const row = getBookingByRef(ctx.db, req.params.ref);
    if (!row || (req.user.role !== 'admin' && row.customer_id !== req.user.id)) {
      throw new HttpError(404, 'Booking not found.');
    }
    res.json({ booking: bookingToJson(ctx, row, req.user) });
  });

  router.post('/bookings/:ref/cancel', requireAuth, (req, res) => {
    if (req.user.role === 'stylist') {
      throw new HttpError(403, 'Stylists cannot cancel bookings.');
    }
    const row = cancelBooking(ctx, {
      actor: req.user,
      ref: req.params.ref,
      reason: req.body ? req.body.reason : undefined,
    });
    res.json({ booking: bookingToJson(ctx, row, req.user) });
  });

  router.post('/bookings/:ref/reschedule', requireAuth, (req, res) => {
    if (req.user.role === 'stylist') {
      throw new HttpError(403, 'Stylists cannot change bookings. The schedule is read only.');
    }
    const row = rescheduleBooking(ctx, {
      actor: req.user,
      ref: req.params.ref,
      newStartIso: req.body ? req.body.start : undefined,
    });
    res.json({ booking: bookingToJson(ctx, row, req.user) });
  });

  return router;
}

module.exports = { createBookingsRouter };
