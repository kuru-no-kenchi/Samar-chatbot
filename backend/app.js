const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const { skipRateLimit } = require('./services/rateLimit');
const { PHOTO_DIR } = require('./services/profilePhoto');
const chatRouter = require('./routes/chat_route');
const userRoutes = require('./routes/userRoute');
const settingsRoute = require('./routes/settings_routes');
const profileRoute = require('./routes/profile_route');

const app = express();

if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, limit: 300,
  standardHeaders: true, legacyHeaders: false,
  skip: skipRateLimit,
}));

app.use('/chat', chatRouter);
app.use('/users', userRoutes);
app.use('/preferences', settingsRoute);
app.use('/profile', profileRoute);
app.use('/users_photos', (req, res, next) => {
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(PHOTO_DIR));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;