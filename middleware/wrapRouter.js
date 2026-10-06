// Auto-wrap async route handlers registered on a router so rejected promises
// reach Express's error middleware instead of crashing the process.
module.exports = function wrapRouter(router) {
  ['get', 'post', 'put', 'patch', 'delete', 'all'].forEach(function (method) {
    var orig = router[method].bind(router);
    router[method] = function (path) {
      var args = Array.prototype.slice.call(arguments, 1);
      var wrapped = args.map(function (fn) {
        if (typeof fn !== 'function') return fn;
        if (fn.constructor.name !== 'AsyncFunction') return fn;
        return function (req, res, next) {
          Promise.resolve(fn(req, res, next)).catch(next);
        };
      });
      return orig.apply(null, [path].concat(wrapped));
    };
  });
  return router;
};
