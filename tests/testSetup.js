// server/app.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());


const certificatesPath = path.join(__dirname, 'certificates');
if (!fs.existsSync(certificatesPath)) {
  fs.mkdirSync(certificatesPath, { recursive: true });
}
app.use('/certificates', express.static(certificatesPath));


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


const authRoutes = require('../routes/authRoutes');
const certificateRoutes = require('../routes/certificateRoutes');
const paymentRoutes = require('../routes/paymentRoutes');
const adminRoutes = require('../routes/adminRoutes');
const conversationRoutes = require('../routes/conversationRoutes');
const notificationRoutes = require('../routes/notificationRoutes');


app.use('/api', authRoutes);
app.use('/api', certificateRoutes);
app.use('/api', paymentRoutes);
app.use('/api', adminRoutes);
app.use('/api', conversationRoutes);
app.use('/api', notificationRoutes);

module.exports = app;
