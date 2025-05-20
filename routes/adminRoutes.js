const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const pool = require('../config/db');
const transporter = require('../config/emailService');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');
const { generateUniqueAdminCode } = require('../helpers/helpers');


router.get('/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const query = `
      SELECT
        u.id,
        u.user_code AS client_code,        -- keep JSON field name unchanged
        u.business_name,
        (
          SELECT COUNT(*)
          FROM certificates
          WHERE certificates.user_id = u.id
        ) AS cert_count
      FROM users u
      WHERE u.role = 'client'
      ORDER BY u.created_at DESC
    `;
    const result = await pool.query(query);

    const users = result.rows.map(row => ({
      id: row.id,
      client_code: row.client_code,
      business_name: row.business_name || null,
      cert_count: Number(row.cert_count) || 0,
    }));

    return res.json({ success: true, users });
  } catch (error) {
    console.error('Error fetching admin users:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});


 // GET single user + their certificates
 
router.get('/admin/users/:userId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }

    const userRes = await pool.query(
      `SELECT id,
              user_code AS client_code,
              role,
              first_name,
              last_name,
              business_name,
              business_type,
              industry,
              contact_email,
              phone_number,
              created_at
       FROM users
       WHERE id = $1 AND role = 'client'
       LIMIT 1`,
      [userId]
    );
    if (userRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: 'User not found or not role=client' });
    }
    const user = userRes.rows[0];

    const certRes = await pool.query(
      `SELECT id, status, created_at, certificate_type, certificate_name
       FROM certificates
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    const certificates = certRes.rows;

    return res.json({
      success: true,
      user,
      certificates,
    });
  } catch (err) {
    console.error('Error in GET /admin/users/:userId:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});


 //GET all certificates

router.get(
  '/admin/certificates',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          c.id                 AS certificate_id,
          c.certificate_name,
          c.certificate_reference,
          c.user_id,
          c.status,
          c.created_at,
          c.assigned_admin_id,
          u.user_code          AS client_code,
          u.role,
          u.first_name,
          u.last_name,
          u.business_name
        FROM certificates c
        JOIN users u ON c.user_id = u.id
        ORDER BY c.created_at DESC
      `);

      return res.json({ success: true, certificates: result.rows });
    } catch (error) {
      console.error('Error fetching admin certificates:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);


router.patch(
  '/admin/certificates/:certificateId/assign-admin',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    const certificateId = parseInt(req.params.certificateId, 10);
    const { assigned_admin_id } = req.body; // integer or null

    if (isNaN(certificateId)) {
      return res.status(400).json({ success: false, error: 'Invalid certificate ID' });
    }
    if (
      assigned_admin_id !== null &&
      assigned_admin_id !== undefined &&
      isNaN(parseInt(assigned_admin_id, 10))
    ) {
      return res
        .status(400)
        .json({ success: false, error: 'assigned_admin_id must be an integer or null' });
    }

    try {
      const updateRes = await pool.query(
        `UPDATE certificates
         SET assigned_admin_id = $1
         WHERE id = $2
         RETURNING id AS certificate_id, assigned_admin_id`,
        [assigned_admin_id ?? null, certificateId]
      );

      if (updateRes.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Certificate not found' });
      }

      return res.json({ success: true, certificate: updateRes.rows[0] });
    } catch (err) {
      console.error('Error assigning admin to certificate:', err);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);


 // Add a new admin
 
router.post('/admin/register', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      title,
      contactEmail,
      phoneNumber
    } = req.body;

    const businessName = 'CertiSphere';
    const businessType = 'Government Agency';
    const industry = 'Government';

    if (!firstName || !lastName || !title || !contactEmail || !phoneNumber) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    
    const emailCheck = await pool.query(
      'SELECT id FROM users WHERE contact_email = $1',
      [contactEmail]
    );
    if (emailCheck.rowCount > 0) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }

    const adminCode = await generateUniqueAdminCode(pool);

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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '', 'admin')
      RETURNING id, user_code AS client_code
    `;
    const values = [
      adminCode,
      businessName,
      businessType,
      industry,
      firstName,
      lastName,
      title,
      contactEmail,
      phoneNumber
    ];
    const result = await pool.query(insertQuery, values);
    const newAdminId = result.rows[0].id;
    const newAdminCode = result.rows[0].client_code;

   
    const mailOptions1 = {
      from: process.env.EMAIL_USER,
      to: contactEmail,
      subject: 'Your New Admin Account Code',
      text: `Hello ${firstName},

You have been registered as an Admin on CertiSphere.

Your Admin Code (username) is: ${newAdminCode}

You will receive another email with a link to set your password.

Best regards,
CertiSphere Team
`,
    };
    await transporter.sendMail(mailOptions1);

    /* reset_token so they can set password */
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      `UPDATE users
       SET reset_token = $1,
           reset_token_expires = $2
       WHERE id = $3`,
      [token, expires, newAdminId]
    );

    
    const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
    const mailOptions2 = {
      from: process.env.EMAIL_USER,
      to: contactEmail,
      subject: 'Set Your Admin Password',
      text: `Hello ${firstName},

Please set your Admin account password by visiting the link below:
${resetLink}

This link will expire in 1 hour.

Once your password is set, you can log in with:
Admin Code: ${newAdminCode}
Password: <the one you set>

Best regards,
CertiSphere Team
`,
    };
    await transporter.sendMail(mailOptions2);

    return res.status(201).json({
      success: true,
      message: 'New admin registered successfully! Emails sent.',
      adminId: newAdminId,
      adminCode: newAdminCode
    });
  } catch (error) {
    console.error('Error registering admin:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


//Admin Dashboard Stats
 
router.get('/admin/dashboard-stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const totalUsersRes = await pool.query(`
      SELECT COUNT(*) AS total
      FROM users
      WHERE role = 'client'
    `);
    const totalUsers = parseInt(totalUsersRes.rows[0].total, 10);

    const totalAdminsRes = await pool.query(`
      SELECT COUNT(*) AS total
      FROM users
      WHERE role = 'admin'
    `);
    const totalAdmins = parseInt(totalAdminsRes.rows[0].total, 10);

    const totalCertRes = await pool.query(`
      SELECT COUNT(*) AS total
      FROM certificates
    `);
    const totalCertificates = parseInt(totalCertRes.rows[0].total, 10);

    const pendingCertRes = await pool.query(`
      SELECT COUNT(*) AS total
      FROM certificates
      WHERE status = 'Submitted'
    `);
    const pendingCertificates = parseInt(pendingCertRes.rows[0].total, 10);

    const completedCertRes = await pool.query(`
      SELECT COUNT(*) AS total
      FROM certificates
      WHERE status = 'Completed'
    `);
    const completedCertificates = parseInt(completedCertRes.rows[0].total, 10);

    /* monthly new users */
    const monthlyUsersRes = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS count
      FROM users
      WHERE role = 'client'
      GROUP BY 1
      ORDER BY 1
    `);
    const monthlyNewUsers = monthlyUsersRes.rows.map((row) => ({
      month: row.month,
      count: parseInt(row.count, 10),
    }));

    /* monthly new certificates */
    const monthlyCertRes = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS count
      FROM certificates
      GROUP BY 1
      ORDER BY 1
    `);
    const monthlyNewCertificates = monthlyCertRes.rows.map((row) => ({
      month: row.month,
      count: parseInt(row.count, 10),
    }));

    return res.json({
      success: true,
      totalUsers,
      totalAdmins,
      totalCertificates,
      pendingCertificates,
      completedCertificates,
      monthlyNewUsers,
      monthlyNewCertificates,
    });
  } catch (err) {
    console.error('Error in /admin/dashboard-stats:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});


 // GET single certificate

router.get('/admin/certificates/:certificateId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const certificateId = parseInt(req.params.certificateId, 10);
    if (isNaN(certificateId)) {
      return res.status(400).json({ success: false, error: 'Invalid certificate ID' });
    }

    const certQuery = `
      SELECT c.id AS certificate_id,
             c.certificate_name,
             c.certificate_type,
             c.user_id,
             c.status,
             c.created_at,
             c.assigned_admin_id,
             u.user_code AS client_code,
             u.first_name,
             u.last_name,
             u.contact_email,
             u.business_name
      FROM certificates c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = $1
    `;
    const result = await pool.query(certQuery, [certificateId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Certificate not found' });
    }

    const certificate = result.rows[0];
    return res.json({ success: true, certificate });
  } catch (error) {
    console.error('Error fetching single certificate:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});


 //GET documents for a certificate

router.get('/admin/certificates/:certificateId/documents', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const certificateId = parseInt(req.params.certificateId, 10);
    if (isNaN(certificateId)) {
      return res.status(400).json({ success: false, error: 'Invalid certificate ID' });
    }

    const docsQuery = `
      SELECT d.id AS document_id,
             d.file_name,
             d.file_path,
             d.uploaded_at,
             d.is_correct,
             c.id AS certificate_id
      FROM documents d
      JOIN certificates c ON d.certificate_id = c.id
      WHERE d.certificate_id = $1
      ORDER BY d.uploaded_at DESC
    `;
    const docsResult = await pool.query(docsQuery, [certificateId]);

    return res.json({
      success: true,
      documents: docsResult.rows,
    });
  } catch (error) {
    console.error('Error fetching certificate documents:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});


 // PATCH update certificate

router.patch('/admin/certificates/:certificateId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const certificateId = parseInt(req.params.certificateId, 10);
    if (isNaN(certificateId)) {
      return res.status(400).json({ success: false, error: 'Invalid certificate ID' });
    }

    const { status, assigned_admin_id } = req.body;
    const updates = [];
    const values = [];

    if (status) {
      updates.push(`status = $${updates.length + 1}`);
      values.push(status);
    }
    if (assigned_admin_id !== undefined) {
      updates.push(`assigned_admin_id = $${updates.length + 1}`);
      values.push(assigned_admin_id);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(certificateId);
    const indexForWhere = updates.length + 1;

    const updateQuery = `
      UPDATE certificates
      SET ${updates.join(', ')}
      WHERE id = $${indexForWhere}
      RETURNING *
    `;
    const updateResult = await pool.query(updateQuery, values);
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Certificate not found' });
    }

    const updatedCertificate = updateResult.rows[0];

    /* generate PDF if status is completed */
    if (status === 'Completed') {
      try {
        const fullDataQuery = `
          SELECT c.*,
                 u.business_name
          FROM certificates c
          JOIN users u ON c.user_id = u.id
          WHERE c.id = $1
        `;
        const fullDataResult = await pool.query(fullDataQuery, [certificateId]);
        if (fullDataResult.rowCount > 0) {
          const certRow = fullDataResult.rows[0];
          const year = new Date().getFullYear();
          const refNumber = `CS#${year}00${certificateId}`;

          const doc = new PDFDocument({ size: 'A4' });
          const pdfPath = path.join(
            __dirname,
            '..',                  
            'certificates',        
            `certificate_${certificateId}.pdf`
          );
          const stream = fs.createWriteStream(pdfPath);
          doc.pipe(stream);

          doc.fontSize(16).text('Certificate of Audit', { align: 'center' });
          doc.moveDown(2);

          doc.fontSize(12).text(
            `Organization: ${certRow.business_name}`,
            { align: 'left' }
          );
          doc.text(
            `Certificate Title: ${certRow.certificate_name || 'Untitled'}`,
            { align: 'left' }
          );
          doc.text(
            `Certificate Type: ${certRow.certificate_type || 'N/A'}`,
            { align: 'left' }
          );
          doc.text(`Certificate Reference #: ${refNumber}`, { align: 'left' });

          const issuanceDate = new Date().toLocaleDateString();
          doc.text(`Date of Issuance: ${issuanceDate}`, { align: 'left' });
          doc.moveDown(2);

          
          let certificateText;
          switch (certRow.certificate_type) {
            case 'Structural Engineering Certificate':
              certificateText = 'hey I m type 1';
              break;
            case 'Geotechnical Engineering Certificate':
              certificateText = 'hey I m type 2';
              break;
            case 'Transportation Engineering Certificate':
              certificateText = 'hey I m type 3';
              break;
            default:
              certificateText = `This certificate is issued after a thorough civil engineering audit,
verifying that the project or organization has met certain technical and safety standards.
All relevant documentation was reviewed to ensure compliance with applicable rules and guidelines.`;
          }

          doc.text(certificateText, { align: 'left' });

          doc.moveDown(2);
          doc.text('Certified by CertiSphere', { align: 'center' });
          doc.end();

          stream.on('finish', () => {
            console.log(`PDF generated at: ${pdfPath}`);
          });
        }
      } catch (pdfErr) {
        console.error('Error generating PDF:', pdfErr);
      }
    }

    return res.json({ success: true, certificate: updatedCertificate });
  } catch (error) {
    console.error('Error updating certificate:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});


 //PATCH update document is_correct
 
router.patch('/admin/documents/:documentId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const documentId = parseInt(req.params.documentId, 10);
    if (isNaN(documentId)) {
      return res.status(400).json({ success: false, error: 'Invalid document ID' });
    }

    const { is_correct } = req.body;
    if (typeof is_correct !== 'boolean') {
      return res
        .status(400)
        .json({ success: false, error: 'Missing or invalid is_correct boolean' });
    }

    const updateQuery = `
      UPDATE documents
      SET is_correct = $1
      WHERE id = $2
      RETURNING id, file_name, is_correct
    `;
    const result = await pool.query(updateQuery, [is_correct, documentId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    return res.json({ success: true, document: result.rows[0] });
  } catch (error) {
    console.error('Error updating document is_correct:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});


 // GET all admins

router.get('/admin/admins', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.user_code AS client_code,
        u.first_name,
        u.last_name,
        u.role
      FROM users u
      WHERE u.role = 'admin'
      ORDER BY u.created_at DESC
    `);
    return res.json({ success: true, admins: result.rows });
  } catch (error) {
    console.error('Error fetching admins:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});


router.get(
  '/admin/payments',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { search = '' } = req.query;
      const params = [];
      let where = `c.status <> 'Pending Payment'`;   // only paid / submitted / completed

      if (search) {
        params.push(`%${search.toString().toLowerCase()}%`);
        where += ` AND (
          LOWER(c.certificate_reference) LIKE $${params.length} OR
          LOWER(u.user_code)              LIKE $${params.length} OR
          LOWER(u.business_name)          LIKE $${params.length}
        )`;
      }

      /* pull price in euro-cents; if still NULL derive it from the type */
      const sql = `
        SELECT
          c.id  AS certificate_id,
          c.certificate_reference,
          u.user_code      AS client_code,
          u.business_name,
          COALESCE(
            c.price,
            CASE
              WHEN c.certificate_type ILIKE 'Structural%'     THEN 15000
              WHEN c.certificate_type ILIKE 'Geotechnical%'   THEN 20000
              WHEN c.certificate_type ILIKE 'Transportation%' THEN 10000
            END
          ) AS price_cents,
          COALESCE(c.paid_at, c.created_at) AS paid_at
        FROM certificates c
        JOIN users u ON u.id = c.user_id
        WHERE ${where}
        ORDER BY paid_at DESC`;
      const { rows } = await pool.query(sql, params);

      const payments = rows.map(r => ({
        certificate_id: r.certificate_id,
        certificate_reference: r.certificate_reference,
        client_code: r.client_code,
        business_name: r.business_name,
        paid_at: r.paid_at,
        amount_eur: (Number(r.price_cents) || 0) / 100   // convert to € float
      }));

      return res.json({ success: true, payments });
    } catch (err) {
      console.error('GET /admin/payments', err);
      res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);




module.exports = router;
