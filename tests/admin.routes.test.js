const request = require('supertest');
const app = require('./testSetup'); // Your Express app

jest.mock('../middlewares/authMiddleware', () => (req, res, next) => next());
jest.mock('../middlewares/adminMiddleware', () => (req, res, next) => next());

describe('Admin API Endpoints', () => {
  it('fetch all client users for admin', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it('fetch a single client user and their certificates', async () => {
    const userId = 1;
    const res = await request(app).get(`/api/admin/users/${userId}`);
    if (res.statusCode === 404) {
      expect(res.body.success).toBe(false);
    } else {
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(Array.isArray(res.body.certificates)).toBe(true);
    }
  });

  it('fetch all certificates for admin', async () => {
    const res = await request(app).get('/api/admin/certificates');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.certificates)).toBe(true);
  });

  it('assign an admin to a certificate', async () => {
    const certificateId = 1;
    const res = await request(app)
      .patch(`/api/admin/certificates/${certificateId}/assign-admin`)
      .send({ assigned_admin_id: 2 });
    if (res.statusCode === 404) {
      expect(res.body.success).toBe(false);
    } else {
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.certificate).toHaveProperty('certificate_id');
    }
  });

  it('fetch dashboard stats', async () => {
    const res = await request(app).get('/api/admin/dashboard-stats');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('totalUsers');
    expect(res.body).toHaveProperty('totalAdmins');
    expect(res.body).toHaveProperty('totalCertificates');
  });

  it('update is_correct for a document', async () => {
    const documentId = 1;
    const res = await request(app)
      .patch(`/api/admin/documents/${documentId}`)
      .send({ is_correct: true });
    if (res.statusCode === 404) {
      expect(res.body.success).toBe(false);
    } else {
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.document).toHaveProperty('document_id');
    }
  });

  it('fetch all admin users', async () => {
    const res = await request(app).get('/api/admin/admins');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.admins)).toBe(true);
  });
  const pool = require('../config/db');

afterAll(async () => {
  await pool.end();
});

});
