// Wrap async route handlers so rejected promises reach Express error middleware.
// Usage: router.get('/x', wrap(async (req, res) => { ... }));
module.exports = function wrap(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
