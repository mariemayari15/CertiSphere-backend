const pool = require('../config/db');

module.exports = (io) => {
  io.on('connection', (socket) => {
    socket.on('joinConversation', (conversationId) => {
      socket.join(`conv_${conversationId}`);
    });

    socket.on('newMessage', async (payload) => {
      try {
        // save message
        const { rows } = await pool.query(
          `INSERT INTO messages
             (conversation_id, sender_id, sender_role, content, created_at)
           VALUES ($1,$2,$3,$4,NOW())
           RETURNING *`,
          [
            payload.conversationId,
            payload.senderId,
            payload.senderRole,
            payload.content
          ]
        );
        const newMsg = rows[0];
        await pool.query(
          `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
          [payload.conversationId]
        );
        const { rows: [conv] } = await pool.query(
          `SELECT conversation_status FROM conversations WHERE id = $1`,
          [payload.conversationId]
        );
        if (conv.conversation_status !== 'team-chat') {
          const newStatus = payload.senderRole === 'admin' ? 'answered' : 'pending';
          await pool.query(
            `UPDATE conversations SET conversation_status = $1 WHERE id = $2`,
            [newStatus, payload.conversationId]
          );
        }
        io.to(`conv_${payload.conversationId}`).emit('messageReceived', newMsg);
      } catch (err) {
        console.error('Error in socket newMessage:', err);
      }
    });
  });
};
