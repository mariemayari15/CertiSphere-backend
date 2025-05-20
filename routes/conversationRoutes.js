const express = require('express');
const router  = express.Router();

const pool            = require('../config/db');
const authMiddleware  = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');

 // create a new conversation with admin
 
router.post(
  '/admin/conversations',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { user_id } = req.body;
      if (!user_id) {
        return res
          .status(400)
          .json({ success: false, error: 'Missing user_id' });
      }

      const adminId = req.user.userId;
      const { rows } = await pool.query(
        `INSERT INTO conversations
           (client_id, admin_id, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING *`,
        [user_id, adminId]
      );
      return res.status(201).json({ success: true, conversation: rows[0] });
    } catch (err) {
      console.error('POST /admin/conversations', err);
      return res
        .status(500)
        .json({ success: false, error: 'Server error' });
    }
  }
);

 //list conversations for admin

router.get(
  '/admin/conversations',
  authMiddleware,
  adminMiddleware,
  async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `
        SELECT
          conversations.*,
          u.user_code        AS client_code,
          c.certificate_name -- ★ bring the certificate name too
        FROM conversations
        JOIN users         u ON u.id = conversations.client_id
        LEFT JOIN certificates c ON c.id = conversations.certificate_id
        ORDER BY conversations.updated_at DESC
        `
      );
      return res.json({ success: true, conversations: rows });
    } catch (err) {
      console.error('GET /admin/conversations', err);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);

// update conversation by admin
 
router.patch(
  '/admin/conversations/:conversationId',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const convId = Number(req.params.conversationId);
      if (!Number.isInteger(convId)) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid conversation ID' });
      }

      const { admin_id, conversation_status } = req.body;
      const fields = [];
      const vals = [];

      if (admin_id !== undefined) {
        fields.push(`admin_id = $${fields.length + 1}`);
        vals.push(admin_id);
      }
      if (conversation_status) {
        fields.push(`conversation_status = $${fields.length + 1}`);
        vals.push(conversation_status);
      }

      if (fields.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: 'No fields to update' });
      }

      vals.push(convId);
      const { rows } = await pool.query(
        `
        UPDATE conversations
           SET ${fields.join(', ')}, updated_at = NOW()
         WHERE id = $${vals.length}
         RETURNING *
        `,
        vals
      );

      if (!rows.length) {
        return res
          .status(404)
          .json({ success: false, error: 'Conversation not found' });
      }

      return res.json({ success: true, conversation: rows[0] });
    } catch (err) {
      console.error('PATCH /admin/conversations/:id', err);
      return res
        .status(500)
        .json({ success: false, error: 'Server error' });
    }
  }
);


 // create conversation

router.post('/conversations', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'client') {
      return res
        .status(403)
        .json({ success: false, error: 'Only users can create conversations' });
    }

    const userId = req.user.userId;
    const { adminId, certificateId } = req.body || {};

    
    let certIdToStore = null;
    if (certificateId) {
      const chk = await pool.query(
        `SELECT id FROM certificates WHERE id = $1 AND user_id = $2`,
        [certificateId, userId]
      );
      if (!chk.rowCount) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid certificateId' });
      }
      certIdToStore = certificateId;
    }

    const { rows } = await pool.query(
      `
      INSERT INTO conversations
        (client_id, admin_id, certificate_id,
         conversation_status, created_at, updated_at)
      VALUES ($1, $2, $3, 'pending', NOW(), NOW())
      RETURNING *
      `,
      [userId, adminId || null, certIdToStore]
    );
    return res.status(201).json({ success: true, conversation: rows[0] });
  } catch (err) {
    console.error('POST /conversations', err);
    return res
      .status(500)
      .json({ success: false, error: 'Server error' });
  }
});


 // list conversations for client

router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'client') {
      return res
        .status(403)
        .json({ success: false, error: 'Only users can view conversations' });
    }

    const { rows } = await pool.query(
      `
      SELECT * 
        FROM conversations
       WHERE client_id = $1
    ORDER BY updated_at DESC
      `,
      [req.user.userId]
    );
    return res.json({ success: true, conversations: rows });
  } catch (err) {
    console.error('GET /conversations', err);
    return res
      .status(500)
      .json({ success: false, error: 'Server error' });
  }
});


 //GET all messages for a conversation 
 
router.get(
  '/conversations/:conversationId/messages',
  authMiddleware,
  async (req, res) => {
    try {
      const convId = Number(req.params.conversationId);
      const { rows } = await pool.query(
        `
        SELECT m.*,
               u.user_code AS client_code
          FROM messages       m
          JOIN conversations  conv ON m.conversation_id = conv.id
          JOIN users          u    ON conv.client_id    = u.id
         WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
        `,
        [convId]
      );
      return res.json({ success: true, messages: rows });
    } catch (err) {
      console.error('GET /conversations/:id/messages', err);
      return res
        .status(500)
        .json({ success: false, error: 'Server error' });
    }
  }
);


 // POST a new message (never override team-chat status)

router.post(
  '/conversations/:conversationId/messages',
  authMiddleware,
  async (req, res) => {
    try {
      const convId     = Number(req.params.conversationId);
      const { content, senderRole } = req.body;
      const senderId   = req.user.userId;

      if (!content?.trim()) {
        return res
          .status(400)
          .json({ success: false, error: 'Message content required' });
      }
      if (!senderRole) {
        return res
          .status(400)
          .json({ success: false, error: 'senderRole required' });
      }

      //  insert the message
      const insert = await pool.query(
        `
        INSERT INTO messages
          (conversation_id, sender_id, sender_role, content, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
        `,
        [convId, senderId, senderRole, content]
      );
      let newMsg = insert.rows[0];

      
      const codeRes = await pool.query(
        `
        SELECT u.user_code AS client_code
          FROM conversations conv
          JOIN users        u ON conv.client_id = u.id
         WHERE conv.id = $1
        `,
        [convId]
      );
      if (codeRes.rowCount) {
        newMsg = { ...newMsg, client_code: codeRes.rows[0].client_code };
      }

      
      await pool.query(
        `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
        [convId]
      );

      // 4) only update status if not team-chat
      const { rows: [conv] } = await pool.query(
        `SELECT conversation_status FROM conversations WHERE id = $1`,
        [convId]
      );
      if (conv.conversation_status !== 'team-chat') {
        const newStatus = senderRole === 'admin' ? 'answered' : 'pending';
        await pool.query(
          `UPDATE conversations SET conversation_status = $1 WHERE id = $2`,
          [newStatus, convId]
        );
      }

      return res.status(201).json({ success: true, message: newMsg });
    } catch (err) {
      console.error('POST /conversations/:id/messages', err);
      return res
        .status(500)
        .json({ success: false, error: 'Server error' });
    }
  }
);


 // fetch the  "team-chat" conversation
 
router.get(
  '/admin/conversations/team-chat',
  authMiddleware,
  adminMiddleware,
  async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `
        SELECT *
          FROM conversations
         WHERE conversation_status = 'team-chat'
         LIMIT 1
        `
      );
      if (!rows.length) {
        return res
          .status(404)
          .json({ success: false, error: 'No team-chat conversation found.' });
      }
      return res.json({ success: true, conversation: rows[0] });
    } catch (err) {
      console.error('GET /admin/conversations/team-chat', err);
      return res
        .status(500)
        .json({ success: false, error: 'Server error' });
    }
  }
);

module.exports = router;
