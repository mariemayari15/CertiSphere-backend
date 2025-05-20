
const express  = require('express');
const router   = express.Router();
const Stripe   = require('stripe');
const stripe   = Stripe(process.env.STRIPE_SECRET_KEY);

const auth = require('../middlewares/authMiddleware');
const pool = require('../config/db');


router.get('/my-pending-certificates', auth, async (req, res) => {
  try {
    const { userId } = req.user;
    const sql = `
      SELECT id,
             status,
             created_at,
             certificate_type,
             certificate_name,
             COALESCE(
               price,
               CASE
                 WHEN certificate_type ILIKE 'Structural%'     THEN 15000
                 WHEN certificate_type ILIKE 'Geotechnical%'   THEN 20000
                 WHEN certificate_type ILIKE 'Transportation%' THEN 10000
               END
             ) AS price
        FROM certificates
       WHERE user_id = $1
         AND status   = 'Pending Payment'
    ORDER BY created_at DESC`;
    const { rows } = await pool.query(sql, [userId]);
    res.json({ success: true, certificates: rows });
  } catch (err) {
    console.error('my-pending-certificates', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});


//Create a PaymentIntent                                                
router.post('/pay-certificate', auth, async (req, res) => {
  try {
    const { userId } = req.user;
    const { certificateId } = req.body;

    /* ensure cert belongs to user and is payable */
    const certQ = await pool.query(
      `SELECT id,
              certificate_type,
              COALESCE(
                price,
                CASE
                  WHEN certificate_type ILIKE 'Structural%'     THEN 15000
                  WHEN certificate_type ILIKE 'Geotechnical%'   THEN 20000
                  WHEN certificate_type ILIKE 'Transportation%' THEN 10000
                END
              ) AS price
         FROM certificates
        WHERE id       = $1
          AND user_id  = $2
          AND status   = 'Pending Payment'`,
      [certificateId, userId]
    );
    if (!certQ.rowCount)
      return res.status(400).json({
        success: false,
        error: 'Certificate not found or not pending payment.',
      });

    const amount = certQ.rows[0].price;     
    if (!amount)
      return res.status(400).json({
        success: false,
        error: 'Cannot determine price for this certificate.',
      });

   
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'eur',
      description: `Payment for Certificate #${certificateId}`,
      automatic_payment_methods: { enabled: true },
      metadata: { certificateId: String(certificateId) },
    });

    res.json({
      success: true,
      clientSecret: intent.client_secret,
      amount,            
    });
  } catch (err) {
    console.error('pay-certificate', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});


// mark the certificate as paid          

router.patch('/certificates/:certificateId/mark-paid', auth, async (req, res) => {
  try {
    const certId = Number(req.params.certificateId);
    const userId = req.user.userId;

    const chk = await pool.query(
      `SELECT created_at
         FROM certificates
        WHERE id=$1 AND user_id=$2 AND status='Pending Payment'`,
      [certId, userId]
    );
    if (!chk.rowCount)
      return res.status(400).json({
        success: false,
        error: 'Certificate not in pending payment state.',
      });

    const { rows:[row] } = await pool.query(
      `UPDATE certificates
          SET status  = 'Submitted',
              paid    = true,
              paid_at = NOW()
        WHERE id = $1
      RETURNING created_at`, [certId]);

    const ref = `CS#${new Date(row.created_at).getFullYear()}00${certId}`;
    await pool.query(
      `UPDATE certificates SET certificate_reference=$1 WHERE id=$2`,
      [ref, certId]
    );

    res.json({
      success: true,
      certificate: { id: certId, status: 'Submitted', certificate_reference: ref },
    });
  } catch (err) {
    console.error('mark-paid', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
router.get('/my-payments', auth, async (req, res) => {
  try {
    const { userId } = req.user;

    const sql = `
      SELECT
        id                        AS certificate_id,
        certificate_reference,
        certificate_name,
        COALESCE(
          price,
          CASE
            WHEN certificate_type ILIKE 'Structural%'     THEN 15000
            WHEN certificate_type ILIKE 'Geotechnical%'   THEN 20000
            WHEN certificate_type ILIKE 'Transportation%' THEN 10000
          END
        ) AS price_cents,
        COALESCE(paid_at, created_at) AS paid_at
      FROM certificates
      WHERE user_id = $1
        AND status  <> 'Pending Payment'          -- already paid / submitted / completed
      ORDER BY paid_at DESC
    `;
    const { rows } = await pool.query(sql, [userId]);

    const payments = rows.map(r => ({
      certificate_id      : r.certificate_id,
      certificate_reference: r.certificate_reference,
      certificate_name    : r.certificate_name,
      amount_eur          : (Number(r.price_cents) || 0) / 100,
      paid_at             : r.paid_at,
    }));

    res.json({ success: true, payments });
  } catch (err) {
    console.error('GET /my-payments', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
module.exports = router;
