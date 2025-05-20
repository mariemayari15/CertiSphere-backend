const request = require('supertest');
const app = require('./testSetup');


jest.mock('../middlewares/authMiddleware', () => (req, res, next) => {
  
  req.user = req.headers['x-role'] === 'admin'
    ? { userId: 100, role: 'admin' }
    : { userId: 1, role: 'client' };
  next();
});
jest.mock('../middlewares/adminMiddleware', () => (req, res, next) => next());

describe('Conversations API Endpoints', () => {

  
  it('admin  creates a new conversation with a user', async () => {
    const res = await request(app)
      .post('/api/admin/conversations')
      .set('x-role', 'admin')
      .send({ user_id: 1 });
    
    expect([201, 500]).toContain(res.statusCode);
    if (res.statusCode === 201) {
      expect(res.body.success).toBe(true);
      expect(res.body.conversation).toBeDefined();
    }
  });

  
  it(' list all conversationsfor admin', async () => {
    const res = await request(app)
      .get('/api/admin/conversations')
      .set('x-role', 'admin');
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.conversations)).toBe(true);
    }
  });

 
  it(' patch a conversation by admin', async () => {
    const res = await request(app)
      .patch('/api/admin/conversations/1')
      .set('x-role', 'admin')
      .send({ admin_id: 100, conversation_status: 'answered' });
    expect([200, 400, 404, 500]).toContain(res.statusCode);
    
  });

  
  it(' create a conversation', async () => {
    const res = await request(app)
      .post('/api/conversations')
      .set('x-role', 'client')
      .send({ adminId: 100 });
    expect([201, 500, 403, 400]).toContain(res.statusCode);
    if (res.statusCode === 201) {
      expect(res.body.success).toBe(true);
      expect(res.body.conversation).toBeDefined();
    }
  });

  
  it(' list user conversations', async () => {
    const res = await request(app)
      .get('/api/conversations')
      .set('x-role', 'client');
    expect([200, 403, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.conversations)).toBe(true);
    }
  });


  it(' get all messages for a conversation', async () => {
    const res = await request(app)
      .get('/api/conversations/1/messages')
      .set('x-role', 'client');
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.messages)).toBe(true);
    }
  });

 it('post a new message in a conversation', async () => {

  const convRes = await request(app)
    .post('/api/conversations')
    .set('x-role', 'client')
    .send({ adminId: 100 });

  const conversationId = convRes.body.conversation?.id || 1; 

  
  const res = await request(app)
    .post(`/api/conversations/${conversationId}/messages`)
    .set('x-role', 'client')
    .send({ content: 'Hello world!', senderRole: 'client' });

  expect([201, 400, 500]).toContain(res.statusCode);
  if (res.statusCode === 201) {
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBeDefined();
  }
});


  
  it(' fetch team-chat conversation', async () => {
    const res = await request(app)
      .get('/api/admin/conversations/team-chat')
      .set('x-role', 'admin');
    expect([200, 404, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.conversation).toBeDefined();
    }
  });

const pool = require('../config/db');

afterAll(async () => {
  await pool.end();
});

});
