const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');

const authMiddleware = require('../middlewares/authMiddleware');
const pool           = require('../config/db');

const CERTIFICATE_TYPES = [
  {
    id: 1,
    typeName: 'Structural Engineering Certificate',
    price: 150_00,   
    requiredDocs: ['Structural Plan', 'Soil Analysis Report', 'Calculation Sheets'],
  },
  {
    id: 2,
    typeName: 'Geotechnical Engineering Certificate',
    price: 200_00,
    requiredDocs: ['Borehole Logs', 'Geotechnical Evaluation', 'Lab Test Results'],
  },
  {
    id: 3,
    typeName: 'Transportation Engineering Certificate',
    price: 100_00,
    requiredDocs: ['Traffic Impact Study', 'Highway Design Documents', 'Safety Analysis'],
  },
];

const ISO_STANDARDS = ['ISO 9001', 'ISO 14001', 'ISO 45001'];


// Multer setup – unique filename on disk, keep real name in DB             
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:   (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext    = path.extname(file.originalname);
    cb(null, `documents-${unique}${ext}`);
  },
});
const upload = multer({ storage });


 //Upload initial documents and creates an empty certificate row       

router.post(
  '/upload-documents',
  authMiddleware,
  upload.array('documents', 5),
  async (req, res) => {
    try {
      const { userId } = req.user;

      const { rows } = await pool.query(
        'INSERT INTO certificates (user_id) VALUES ($1) RETURNING id',
        [userId]
      );
      const certificateId = rows[0].id;

      for (const file of req.files) {
        await pool.query(
          `INSERT INTO documents (certificate_id, user_id, file_name, file_path)
           VALUES ($1, $2, $3, $4)`,
          [certificateId, userId, file.originalname, file.path]
        );
      }

      return res.json({
        success: true,
        message: 'Documents uploaded successfully',
        certificateId,
      });
    } catch (err) {
      console.error('upload-documents error:', err);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);


 // Upload a doc in response to a notification                          

router.post(
  '/notifications/:notifId/upload-document',
  authMiddleware,
  upload.single('document'),
  async (req, res) => {
    try {
      const notifId = Number(req.params.notifId);
      if (!Number.isInteger(notifId))
        return res.status(400).json({ success: false, error: 'Invalid notification ID' });

      const { userId } = req.user;

      const { rows } = await pool.query(
        `SELECT id, certificate_id, request_new_document
           FROM notifications
          WHERE id = $1 AND user_id = $2
          LIMIT 1`,
        [notifId, userId]
      );
      if (!rows.length)
        return res.status(404).json({ success: false, error: 'Notification not found or not yours' });

      const { certificate_id, request_new_document } = rows[0];
      if (!certificate_id)
        return res.status(400).json({ success: false, error: 'Notification has no certificate' });
      if (!request_new_document)
        return res.status(400).json({ success: false, error: 'Notification did not request a new document' });
      if (!req.file)
        return res.status(400).json({ success: false, error: 'No file provided' });

      await pool.query(
        `INSERT INTO documents (certificate_id, user_id, file_name, file_path)
         VALUES ($1, $2, $3, $4)`,
        [certificate_id, userId, req.file.originalname, req.file.path]
      );

      /* notify assigned admin  */
      const admin = await pool.query(
        'SELECT assigned_admin_id FROM certificates WHERE id = $1',
        [certificate_id]
      );
      const adminId = admin.rowCount ? admin.rows[0].assigned_admin_id : null;

      if (adminId) {
        const msg = `User uploaded a new document for certificate #${certificate_id}`;
        await pool.query(
          `INSERT INTO notifications (user_id, certificate_id, message, is_read, request_new_document)
           VALUES ($1, $2, $3, false, false)`,
          [adminId, certificate_id, msg]
        );
      }

      return res.json({ success: true, message: 'Document uploaded and admin notified.' });
    } catch (err) {
      console.error('notif upload error:', err);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);


 // List of certificate types + ISO standards                           

router.get('/certificate-types', authMiddleware, (_req, res) =>
  res.json({
    success: true,
    data: { certificateTypes: CERTIFICATE_TYPES, isoStandards: ISO_STANDARDS },
  })
);


                        

router.post('/generate-certificate', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const {
      certificateId,
      certificateType,          // number (preferred) *or* string
      certificateName,
      isoStandards,
    } = req.body;

    if (!certificateId)
      return res.status(400).json({ success: false, error: 'Missing certificateId' });

    /* verify ownership */
    const ok = await pool.query(
      'SELECT id FROM certificates WHERE id = $1 AND user_id = $2',
      [certificateId, userId]
    );
    if (!ok.rowCount)
      return res.status(403).json({ success: false, error: 'Certificate not found or not yours' });

    /* translate incoming value */
    let typeName = null;
    let price    = null;

    const numericId = Number(certificateType);
    if (!Number.isNaN(numericId)) {
      const found = CERTIFICATE_TYPES.find((t) => t.id === numericId);
      if (found) {
        typeName = found.typeName;
        price    = found.price;
      }
    }

    
    if (!typeName) {
      const found = CERTIFICATE_TYPES.find((t) => t.typeName === certificateType);
      typeName = certificateType || null;
      price    = found ? found.price : null;
    }

    const { rows } = await pool.query(
      `UPDATE certificates
          SET status           = 'Pending Payment',
              certificate_type = $1,
              certificate_name = $2,
              iso_standards    = $3,
              price            = $4,
              paid             = false
        WHERE id = $5
      RETURNING id, status, certificate_type, certificate_name,
                iso_standards, price, paid`,
      [
        typeName,
        certificateName || null,
        isoStandards    || null,
        price,
        certificateId,
      ]
    );

    res.json({
      success: true,
      message: 'Certificate data saved. Awaiting payment.',
      certificate: rows[0],
    });
  } catch (err) {
    console.error('generate-certificate error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});


//client certificates list                                             

router.get('/my-certificates', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const { rows }   = await pool.query(
      `SELECT id, status, created_at,
              certificate_type, certificate_name, iso_standards,
              price, paid, paid_at
         FROM certificates
        WHERE user_id = $1
     ORDER BY created_at DESC`,
      [userId]
    );
    res.json({ success: true, certificates: rows });
  } catch (err) {
    console.error('my-certificates error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});


//Single certificate by ID       

router.get(
  '/admin/certificates/:id',
  authMiddleware,                    
  async (req, res) => {
    try {
      const certId = Number(req.params.id);
      if (!Number.isInteger(certId)) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid certificate ID' });
      }

      const { rows } = await pool.query(
        `
        SELECT
          c.id                     AS certificate_id,
          c.certificate_reference,
          c.user_id,
          c.status,
          c.created_at,
          u.user_code              AS client_code,   -- ✔ correct column name
          u.first_name,
          u.last_name,
          u.contact_email,
          u.business_name
        FROM certificates c
        JOIN users u ON u.id = c.user_id
        WHERE c.id = $1
        `,
        [certId]
      );

      if (!rows.length) {
        return res
          .status(404)
          .json({ success: false, error: 'Certificate not found' });
      }

      res.json({ success: true, certificate: rows[0] });
    } catch (err) {
      console.error('GET /admin/certificates/:id', err);
      res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);


//client's doc list                                                 

router.get('/my-documents', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const { rows }   = await pool.query(
      `SELECT
          d.id              AS document_id,
          d.file_name,
          d.file_path,
          d.uploaded_at,
          c.certificate_name,
          c.status          AS certificate_status,
          c.price,
          c.paid
         FROM documents d
         JOIN certificates c ON c.id = d.certificate_id
        WHERE d.user_id = $1
     ORDER BY d.uploaded_at DESC`,
      [userId]
    );
    res.json({ success: true, documents: rows });
  } catch (err) {
    console.error('my-documents error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// server/routes/certificates.js (or similar)
router.get('/certificates/:id', authMiddleware, async (req, res) => {
  try {
    const certId = Number(req.params.id);
    if (!Number.isInteger(certId)) {
      return res.status(400).json({ success: false, error: 'Invalid certificate ID' });
    }

    const { userId } = req.user;
    const { rows } = await pool.query(
      `SELECT id, status, created_at, certificate_type, certificate_name, iso_standards
         FROM certificates
        WHERE id = $1 AND user_id = $2`,
      [certId, userId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Certificate not found' });
    }

    res.json({ success: true, certificate: rows[0] });
  } catch (err) {
    console.error('GET /certificates/:id error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});


module.exports = router;
