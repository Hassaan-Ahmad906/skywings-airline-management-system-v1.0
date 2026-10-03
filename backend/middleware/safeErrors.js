module.exports = (req, res, next) => {
  const json = res.json;
  res.json = function (body) {
    if (this.statusCode >= 500) body = { success: false, message: 'The request could not be completed. Please retry.', error: { code: 'INTERNAL_ERROR' }, request_id: req.id };
    return json.call(this, body);
  };
  next();
};
