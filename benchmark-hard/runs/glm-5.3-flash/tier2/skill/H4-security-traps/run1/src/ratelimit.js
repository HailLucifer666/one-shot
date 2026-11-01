// Fixed-window in-memory rate limiter, keyed per IP per mount point.
// Sufficient for a single-process local app; not a distributed limiter.
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return function rateLimitMiddleware(req, res, next) {
    const key = req.user ? `u:${req.user.id}` : `ip:${req.ip || "unknown"}`;
    const now = Date.now();
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (now > v.reset) hits.delete(k);
      }
    }
    const entry = hits.get(key);
    if (!entry || now > entry.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).send("Too many requests. Please try again later.");
    }
    return next();
  };
}
