const express = require('express');
function wrap(handler) {
  if (Array.isArray(handler)) return handler.map(wrap);
  if (typeof handler !== 'function' || handler.handle) return handler;
  if (handler.length === 4) return function (error, req, res, next) { Promise.resolve().then(() => handler(error, req, res, next)).catch(next); };
  return function (req, res, next) { Promise.resolve().then(() => handler(req, res, next)).catch(next); };
}
module.exports = () => {
  const router = express.Router();
  for (const method of ['get','post','put','patch','delete','use']) {
    const original = router[method];
    router[method] = function (...args) { return original.apply(this, args.map(wrap)); };
  }
  return router;
};
