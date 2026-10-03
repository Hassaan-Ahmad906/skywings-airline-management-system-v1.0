module.exports = function rateLimit({ limit = 20, windowMs = 15 * 60000, now = Date.now } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const time = now(), key = req.ip || req.socket?.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= time) {
      if (buckets.size >= 10000) {
        for (const [address, entry] of buckets) if (entry.until <= time) buckets.delete(address);
        if (buckets.size >= 10000) return res.status(429).json({ success: false, message: 'Please retry later.' });
      }
      bucket = { count: 0, until: time + windowMs }; buckets.set(key, bucket);
    }
    if (++bucket.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.until - time) / 1000))));
      return res.status(429).json({ success: false, message: 'Too many requests. Please wait and retry.' });
    }
    next();
  };
};
