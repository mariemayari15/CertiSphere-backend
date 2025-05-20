const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, error: 'Malformed token' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      userId: decoded.userId,
      clientCode: decoded.clientCode,
      role: decoded.role,
    };
    next();
  } catch (err) {
    console.error('Error in authMiddleware:', err);
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
