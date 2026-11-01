'use strict';

/**
 * Display helpers. Everything is stored in UTC and rendered in the salon
 * timezone (America/Chicago), which Luxon resolves correctly across daylight
 * saving changes (CDT = UTC-5 in summer, CST = UTC-6 in winter).
 */

const { DateTime } = require('luxon');
const config = require('./config');

function parseUtc(iso) {
  return DateTime.fromISO(iso, { zone: 'utc' });
}

/** Salon-local wall clock for a stored UTC timestamp. */
function zoned(utcIso) {
  return parseUtc(utcIso).setZone(config.SALON_TZ);
}

/** "2027-03-15 09:00" local */
function localDateTime(utcIso) {
  return zoned(utcIso).toFormat('yyyy-MM-dd HH:mm');
}

/** "9:00 AM" local */
function localTime(utcIso) {
  return zoned(utcIso).toFormat('h:mm a');
}

/** "Monday, March 15, 2027, 9:00 AM" local */
function localLong(utcIso) {
  return zoned(utcIso).toFormat("cccc, LLLL d, yyyy, h:mm a");
}

/** "2027-03-15" local calendar date */
function localDate(utcIso) {
  return zoned(utcIso).toFormat('yyyy-MM-dd');
}

module.exports = { parseUtc, zoned, localDateTime, localTime, localLong, localDate };
