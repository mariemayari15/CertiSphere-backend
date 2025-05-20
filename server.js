require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());


const certificatesPath = path.join(__dirname, 'certificates');
if (!fs.existsSync(certificatesPath)) {
  fs.mkdirSync(certificatesPath, { recursive: true });
}
app.use('/certificates', express.static(certificatesPath));


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

//  ROUTES IMPORTS
const authRoutes = require('./routes/authRoutes');
const certificateRoutes = require('./routes/certificateRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const conversationRoutes = require('./routes/conversationRoutes');
const notificationRoutes = require('./routes/notificationRoutes');


app.use('/api', authRoutes);
app.use('/api', certificateRoutes);
app.use('/api', paymentRoutes);
app.use('/api', adminRoutes);
app.use('/api', conversationRoutes);
app.use('/api', notificationRoutes);

//SOCKET.IO SETUP 
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});


require('./socket/socket')(io);

//START SERVER
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
