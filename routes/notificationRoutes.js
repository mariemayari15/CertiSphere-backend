const express     = require('express');
const router      = express.Router();
const pool        = require('../config/db');
const auth        = require('../middlewares/authMiddleware');
const adminCheck  = require('../middlewares/adminMiddleware');
const transporter = require('../config/emailService');


 //  CREATE notification
 
router.post(
  '/admin/notifications',
  auth,
  adminCheck,
  async (req, res) => {
    try {
      const { user_id, certificate_id, message, request_new_document } = req.body;
      if (!user_id || !message) {
        return res.status(400).json({ success: false, error: 'Missing user_id or message' });
      }

      const insertQuery = `
        INSERT INTO notifications (user_id, certificate_id, message, is_read, request_new_document)
        VALUES ($1, $2, $3, false, $4)
        RETURNING *
      `;
      const values = [user_id, certificate_id || null, message, !!request_new_document];
      const { rows: [newNotification] } = await pool.query(insertQuery, values);

      if (request_new_document && certificate_id) {
        await pool.query(
          `UPDATE certificates
             SET status = 'Additional Documents Required'
           WHERE id = $1`,
          [certificate_id]
        );
      }

      const { rows: [user] } = await pool.query(
        `SELECT contact_email, first_name
           FROM users
          WHERE id = $1
          LIMIT 1`,
        [user_id]
      );
      if (user?.contact_email) {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: user.contact_email,
          subject: 'New Notification from CertiSphere',
          text: `Hello ${user.first_name || ''},\n\n${message}\n\nPlease log in to view details.\n\n— CertiSphere Team`
        };
        transporter.sendMail(mailOptions).catch(err => console.error('Email error:', err));
      }

      return res.status(201).json({ success: true, notification: newNotification });
    } catch (error) {
      console.error('POST /admin/notifications error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);


 // GET Notifications for Current User
 
router.get(
  '/notifications',
  auth,
  async (req, res) => {
    try {
      const userId = req.user.userId;

      const { rows } = await pool.query(
        `SELECT id, certificate_id, message, is_read, created_at, request_new_document
           FROM notifications
          WHERE user_id = $1
          ORDER BY created_at DESC`,
        [userId]
      );

      const unreadCount = rows.reduce((sum, n) => sum + (n.is_read ? 0 : 1), 0);

      return res.json({ success: true, notifications: rows, unreadCount });
    } catch (error) {
      console.error('GET /notifications error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);


 // PATCH Mark Notification as read

router.patch(
  '/notifications/:notifId',
  auth,
  async (req, res) => {
    try {
      const notifId = parseInt(req.params.notifId, 10);
      if (isNaN(notifId)) {
        return res.status(400).json({ success: false, error: 'Invalid notification ID' });
      }
      const { is_read } = req.body;
      if (typeof is_read !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Invalid is_read flag' });
      }

      const { rows: [owner] } = await pool.query(
        `SELECT user_id FROM notifications WHERE id = $1`,
        [notifId]
      );
      if (!owner) {
        return res.status(404).json({ success: false, error: 'Notification not found' });
      }
      if (owner.user_id !== req.user.userId && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Not allowed' });
      }

      const { rows: [updated] } = await pool.query(
        `UPDATE notifications
            SET is_read = $1
          WHERE id = $2
         RETURNING *`,
        [is_read, notifId]
      );

      return res.json({ success: true, notification: updated });
    } catch (error) {
      console.error('PATCH /notifications/:notifId error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);


 // GET Notifications + unreadCount

router.get(
  '/admin/notifications',
  auth,
  adminCheck,
  async (req, res) => {
    try {
      const adminId = req.user.userId;

      const { rows } = await pool.query(
        `SELECT id, user_id, certificate_id, message, is_read, created_at, request_new_document
           FROM notifications
          WHERE user_id = $1
          ORDER BY created_at DESC`,
        [adminId]
      );

      const unreadCount = rows.reduce((sum, n) => sum + (n.is_read ? 0 : 1), 0);

      return res.json({ success: true, notifications: rows, unreadCount });
    } catch (err) {
      console.error('GET /admin/notifications error:', err);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);

module.exports = router;
