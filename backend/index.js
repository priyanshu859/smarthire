const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const analyzeRouter = require('./routes/analyze');
app.use('/api', analyzeRouter);

app.get('/', (req, res) => {
  res.json({ message: 'SmartHire API is running!' });
});

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
