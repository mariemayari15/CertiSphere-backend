const request = require('supertest');
const app = require('./testSetup'); 


jest.mock('../middlewares/authMiddleware', () => (req, res, next) => {
  req.user = { userId: 1 }; 
  next();
});



describe('Certificates API Endpoints', () => {
 
  it('return list of certificate types and ISO standards', async () => {
    const res = await request(app).get('/api/certificate-types');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('certificateTypes');
    expect(res.body.data).toHaveProperty('isoStandards');
    expect(Array.isArray(res.body.data.certificateTypes)).toBe(true);
    expect(Array.isArray(res.body.data.isoStandards)).toBe(true);
  });


  it('return my certificates', async () => {
    const res = await request(app).get('/api/my-certificates');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.certificates)).toBe(true);
  });

 
  it('return my documents', async () => {
    const res = await request(app).get('/api/my-documents');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.documents)).toBe(true);
  });

  
  it('return a certificate by id for the user', async () => {
    const res = await request(app).get('/api/certificates/1');
    if (res.statusCode === 404) {
      expect(res.body.success).toBe(false);
    } else if (res.statusCode === 400) {
      expect(res.body.success).toBe(false);
    } else {
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.certificate).toBeDefined();
    }
  });


  it(' return a certificate by id for admin', async () => {
    const res = await request(app).get('/api/admin/certificates/1');
    if (res.statusCode === 404) {
      expect(res.body.success).toBe(false);
    } else if (res.statusCode === 400) {
      expect(res.body.success).toBe(false);
    } else {
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.certificate).toBeDefined();
    }
  });
  const pool = require('../config/db');

afterAll(async () => {
  await pool.end();
});

});
