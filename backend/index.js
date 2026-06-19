const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Security headers
app.use(helmet());

// CORS - sirf frontend allow
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://accomplished-respect-production-12ef.up.railway.app'
  ],
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '5mb' }));

// File validation middleware
const validateFile = (req, res, next) => {
  if (!req.file && !req.files) return next();

  const file = req.file || req.files[0];
  if (!file) return next();

  // PDF only
  if (file.mimetype !== 'application/pdf') {
    return res.status(400).json({ error: 'Only PDF files allowed' });
  }

  // Max 5MB
  if (file.size > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'File size must be under 5MB' });
  }

  next();
};

const analyzeRouter = require('./routes/analyze');
app.use('/api', analyzeRouter);

app.get('/', (req, res) => {
  res.json({ message: 'SmartHire API is running!' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { validateFile };