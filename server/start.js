// Render/production bootstrap: preserve the raw webhook body while keeping JSON parsing for the rest of the API.
const express = require('express');
const originalJson = express.json;
const originalRaw = express.raw;
express.json = (options = {}) => originalJson({
  ...options,
  verify(req, res, buf) {
    req.rawBody = Buffer.from(buf);
    if (typeof options.verify === 'function') options.verify(req, res, buf);
  }
});
express.raw = (options = {}) => {
  const middleware = originalRaw(options);
  return (req, res, next) => {
    if (req.rawBody) {
      req.body = req.rawBody;
      return next();
    }
    return middleware(req, res, next);
  };
};
require('./index');
