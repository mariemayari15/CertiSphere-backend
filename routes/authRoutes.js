const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');

const pool        = require('../config/db');
const transporter = require('../config/emailService');
const { generateUniqueClientCode } = require('../helpers/helpers');
const auth        = require('../middlewares/authMiddleware');
const { v4: uuid } = require('uuid');   


router.post('/register', async (req, res) => {
  try {
    const {
      businessName,
      businessType,
      industry,
      contactName,
      title,
      contactEmail,
      phoneNumber,
      password,
    } = req.body;

    const { firstName, lastName } = contactName || {};
    if (
      !businessName ||
      !businessType ||
      !industry ||
      !firstName ||
      !lastName ||
      !title ||
      !contactEmail ||
      !phoneNumber ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const clientCode   = await generateUniqueClientCode(businessName, pool);
    const passwordHash = await bcrypt.hash(password, 10);

    const insertQuery = `
      INSERT INTO users (
        user_code,
        business_name,
        business_type,
        industry,
        first_name,
        last_name,
        title,
        contact_email,
        phone_number,
        password_hash,
        role
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'client')
      RETURNING id
    `;
    const insertValues = [
      clientCode,
      businessName,
      businessType,
      industry,
      firstName,
      lastName,
      title,
      contactEmail,
      phoneNumber,
      passwordHash,
    ];
    const result   = await pool.query(insertQuery, insertValues);
    const clientId = result.rows[0].id;

    
    await transporter.sendMail({
      from   : process.env.EMAIL_USER,
      to     : contactEmail,
      subject: 'Your Client Code',
      text   : `Hello ${firstName},\n\nHere is your client code: ${clientCode}\n\nThank you!`,
    });

    return res.status(201).json({ success:true, clientId, clientCode });
  } catch (error) {
    console.error('Error registering client:', error);
    return res.status(500).json({ success:false, error:'Internal server error' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { clientCode, password } = req.body;
    if (!clientCode || !password) {
      return res.status(400).json({ success:false, error:'Missing fields' });
    }

    const query  = `
      SELECT id, password_hash, role
      FROM users
      WHERE user_code = $1
    `;
    const result = await pool.query(query, [clientCode]);
    if (result.rowCount === 0) {
      return res
        .status(401)
        .json({ success:false, error:'Invalid code or password' });
    }

    const { id, password_hash, role } = result.rows[0];
    const match = await bcrypt.compare(password, password_hash);
    if (!match) {
      return res
        .status(401)
        .json({ success:false, error:'Invalid code or password' });
    }

    const token = jwt.sign(
      { userId:id, clientCode, role },
      process.env.JWT_SECRET,
      { expiresIn:'1h' }
    );

    return res.json({
      success : true,
      message : 'Login successful',
      clientId: id,
      token,
    });
  } catch (error) {
    console.error('Error logging in:', error);
    return res.status(500).json({ success:false, error:'Internal server error' });
  }
});

// FORGOT PASSWORD 
router.post('/forgot-password', async (req, res) => {
  try {
    const { clientCode } = req.body;
    if (!clientCode) {
      return res
        .status(400)
        .json({ success:false, error:'Client code is required.' });
    }

    const findRes = await pool.query(
      'SELECT id, contact_email FROM users WHERE user_code = $1',
      [clientCode]
    );
    if (findRes.rowCount === 0) {
      return res
        .status(400)
        .json({ success:false, error:'Invalid client code.' });
    }

    const { id, contact_email } = findRes.rows[0];
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60*60*1000); // 1 hour

    await pool.query(
      `UPDATE users
       SET reset_token = $1,
           reset_token_expires = $2
       WHERE id = $3`,
      [token, expires, id]
    );

    const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
    await transporter.sendMail({
      from   : process.env.EMAIL_USER,
      to     : contact_email,
      subject: 'Password Reset Request',
      text   : `Hello,

We received a password reset request for your account.

Please click the link below (or copy and paste it into your browser) to reset your password:
${resetLink}

This link will expire in 1 hour.

If you didn't request a password reset, you can ignore this message.
`,
    });

    return res.json({
      success: true,
      message: 'A password reset email has been sent.',
    });
  } catch (error) {
    console.error('Error in forgot-password:', error);
    return res.status(500).json({ success:false, error:'Server error' });
  }
});

//RESET PASSWORD 
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res
        .status(400)
        .json({ success:false, error:'Missing token or new password' });
    }

    const clientRes = await pool.query(
      `SELECT id, reset_token_expires
       FROM users
       WHERE reset_token = $1`,
      [token]
    );
    if (clientRes.rowCount === 0) {
      return res
        .status(400)
        .json({ success:false, error:'Invalid or expired reset token' });
    }

    const { id, reset_token_expires } = clientRes.rows[0];
    if (new Date() > reset_token_expires) {
      return res
        .status(400)
        .json({ success:false, error:'Reset token has expired' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           reset_token   = NULL,
           reset_token_expires = NULL
       WHERE id = $2`,
      [newPasswordHash, id]
    );

    return res.json({ success:true, message:'Password reset successful' });
  } catch (error) {
    console.error('Error in reset-password:', error);
    return res.status(500).json({ success:false, error:'Server error' });
  }
});


 //REQUEST PASSWORD CHANGE (logged-in user)

router.post('/change-password-request', auth, async (req, res) => {
  try {
    const { oldPassword } = req.body;
    const userId = req.user.userId;

    if (!oldPassword)
      return res.status(400).json({ success:false, error:'Old password required' });

    // verify old password
    const q = await pool.query(
      'SELECT password_hash, contact_email, user_code AS client_code FROM users WHERE id = $1',
      [userId]
    );
    if (!q.rowCount)
      return res.status(404).json({ success:false, error:'User not found' });

    const { password_hash, contact_email, client_code } = q.rows[0];
    const ok = await bcrypt.compare(oldPassword, password_hash);
    if (!ok)
      return res.status(401).json({ success:false, error:'Old password is incorrect' });

    // generate one-time token
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60*60*1000);

    await pool.query(
      'UPDATE users SET reset_token=$1, reset_token_expires=$2 WHERE id=$3',
      [token, expires, userId]
    );

    const link = `${process.env.CLIENT_URL}/reset-password?token=${token}`;

    await transporter.sendMail({
      from   : process.env.EMAIL_USER,
      to     : contact_email,
      subject: 'Confirm your password change',
      text   : `Hello ${client_code},

We received a request to change your password.
Click the link below to set a new one:

${link}

The link expires in 1 hour. If you didn’t request this, just ignore the e-mail.`,
    });

    return res.json({
      success: true,
      message: 'E-mail sent – follow the link to set your new password.',
    });
  } catch (err) {
    console.error('POST /change-password-request', err);
    res.status(500).json({ success:false, error:'Server error' });
  }
});

// GET my profile 
router.get('/profile', auth, async (req, res) => {
  try {
    const { userId } = req.user;
    const { rows }   = await pool.query(
      `SELECT id,
              user_code AS client_code,
              business_name, business_type, industry,
              first_name, last_name, title, contact_email,
              phone_number, created_at, role
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (!rows.length)
      return res.status(404).json({ success:false, error:'User not found' });

    return res.json({ success:true, profile: rows[0] });
  } catch (err) {
    console.error('GET /profile', err);
    res.status(500).json({ success:false, error:'Server error' });
  }
});


 // REQUEST profile change  
 
router.put('/profile', auth, async (req, res) => {
  try {
    const { userId } = req.user;

    const allowed = [
      'business_name','business_type','industry',
      'first_name','last_name','title',
      'contact_email','phone_number',
    ];
    const changes = {};
    allowed.forEach(k => {
      if (k in req.body) changes[k] = req.body[k];
    });

    if (!Object.keys(changes).length)
      return res.status(400).json({ success:false, error:'No valid fields supplied' });

    // signed one-time token with changes
    const token = jwt.sign(
      { userId, changes },
      process.env.JWT_SECRET,
      { expiresIn:'1h' }
    );

    // send verification e-mail
    const emailRes = await pool.query(
      'SELECT contact_email, first_name FROM users WHERE id=$1',
      [userId]
    );
    const { contact_email, first_name } = emailRes.rows[0];
    const verifyLink = `${process.env.SERVER_URL}/api/profile/verify/${token}`;

    await transporter.sendMail({
      from   : process.env.EMAIL_USER,
      to     : contact_email,
      subject: 'Confirm your profile changes',
      text   : `Hello ${first_name || ''},

We received a request to update your profile.  
To apply the following changes, click the link below:

${verifyLink}

If you did not request this, just ignore the e-mail.  
This link expires in 1 hour.`,
    });

    return res.json({
      success: true,
      message: 'Verification e-mail sent. Changes will be applied after confirmation.',
    });
  } catch (err) {
    console.error('PUT /profile', err);
    res.status(500).json({ success:false, error:'Server error' });
  }
});


 // VERIFY token 
 
router.get('/profile/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res
        .status(400)
        .json({ success:false, error:'Invalid or expired token' });
    }

    const { userId, changes } = payload;

    // dynamic UPDATE
    const fields = [];
    const vals   = [];
    Object.entries(changes).forEach(([k, v]) => {
      fields.push(`${k} = $${fields.length + 1}`);
      vals.push(v);
    });
    vals.push(userId);

    await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${vals.length}`,
      vals
    );

    res.json({ success:true, message:'Profile successfully updated!' });
  } catch (err) {
    console.error('GET /profile/verify', err);
    res.status(500).json({ success:false, error:'Server error' });
  }
});
 
router.post('/request-account-deletion', auth, async (req, res) => {
  try {
    const { userId } = req.user;

    /* generate 24-h one-time token */
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);   // +24 h

    await pool.query(
      `UPDATE users
         SET delete_token = $1,
             delete_token_expires = $2
       WHERE id = $3`,
      [token, expires, userId]
    );

    /* e-mail the link ── NOTE: we use SERVER_URL (back-end), not CLIENT_URL */
    const { rows } = await pool.query(
      'SELECT contact_email, first_name FROM users WHERE id = $1',
      [userId]
    );
    const { contact_email, first_name } = rows[0];

    const link = `${process.env.SERVER_URL}/api/confirm-account-deletion/${token}`;

    await transporter.sendMail({
      from   : process.env.EMAIL_USER,
      to     : contact_email,
      subject: 'Confirm your account deletion',
      text   : `Hi ${first_name || ''},

You asked us to delete your CertiSphere account.
Click the link below to confirm (valid for 24 h):

${link}

If you didn’t request this, simply ignore the e-mail.`,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('POST /request-account-deletion', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});



router.get('/confirm-account-deletion/:token', async (req, res) => {
  const token  = decodeURIComponent(req.params.token || '').trim();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const valid = await client.query(
      `SELECT id
         FROM users
        WHERE delete_token = $1
          AND delete_token_expires > NOW()
        LIMIT 1`,
      [token]
    );
    if (!valid.rowCount) throw new Error('invalid-token');

    const userId = valid.rows[0].id;

      await client.query(
      `DELETE FROM messages
        WHERE conversation_id IN (
              SELECT id FROM conversations WHERE client_id = $1
        )`,
      [userId]
    );
    await client.query(
      `DELETE FROM messages WHERE sender_id = $1`,
      [userId]
    );

 
    await client.query(
      `DELETE FROM conversations WHERE client_id = $1`,
      [userId]
    );

  
    await client.query(
      `DELETE FROM documents WHERE user_id = $1`,
      [userId]
    );

   
    await client.query(
      `DELETE FROM notifications WHERE user_id = $1`,
      [userId]
    );

   
    await client.query(
      `DELETE FROM certificates WHERE user_id = $1`,
      [userId]
    );

    
    await client.query(
      `DELETE FROM users WHERE id = $1`,
      [userId]
    );

    await client.query('COMMIT');

    res.send(
      '<h2>Account deleted</h2>' +
      '<p>Your account and all related data have been permanently removed.</p>'
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('GET /confirm-account-deletion', err);
    res.status(400).send('Invalid or expired link.');
  } finally {
    client.release();
  }
});
module.exports = router;
