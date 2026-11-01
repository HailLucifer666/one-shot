/**
 * Testable clock. CUTWELL_NOW (ISO 8601 instant, e.g. 2027-03-13T12:00:00Z)
 * overrides the current time; it is read on every call so tests can move the
 * clock without restarting. Documented in README "Setting the clock for testing".
 */
export function now(): Date {
  const raw = process.env.CUTWELL_NOW;
  if (raw === undefined || raw.trim() === "") return new Date();
  const parsed = new Date(raw.trim());
  if (Number.isNaN(parsed.getTime())) {
    console.warn(`CUTWELL_NOW="${raw}" is not a valid ISO 8601 instant; using the real clock.`);
    return new Date();
  }
  return parsed;
}
