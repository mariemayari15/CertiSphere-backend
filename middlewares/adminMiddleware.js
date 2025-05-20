function adminMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden: Admins only' });
    }
    next();
  }
  
  module.exports = adminMiddleware;
  