import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { AccessToken } from 'livekit-server-sdk';
import { timingSafeEqual } from 'node:crypto';

const app = express();
const port = Number(process.env.PORT || 3001);
const required = ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_CLOUD_URL', 'ROOM_PASSWORD', 'APP_ORIGIN'];
for (const key of required) {
  if (!process.env[key] || process.env[key].includes('CHANGE_THIS')) {
    console.error(`Missing or placeholder environment variable: ${key}`);
    process.exit(1);
  }
}
const livekitUrl = process.env.LIVEKIT_CLOUD_URL.trim();
if (!/^wss:\/\//i.test(livekitUrl)) {
  console.error('LIVEKIT_CLOUD_URL must start with wss://');
  process.exit(1);
}
const allowedOrigins = process.env.APP_ORIGIN.split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({ origin(origin, cb) {
  if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
  return cb(new Error('Origin not allowed'));
}}));
app.use(express.json({ limit: '8kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: true, legacyHeaders: false }));

function safeEqual(a, b) {
  const aa = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'pmr-livekit-cloud-token-api' }));
app.post('/token', async (req, res) => {
  try {
    const { roomName, identity, roomPassword } = req.body || {};
    const room = String(roomName || '').trim().toLowerCase();
    const participant = String(identity || '').trim();
    if (!room || room.length > 80 || !/^[a-z0-9][a-z0-9_-]*$/.test(room)) {
      return res.status(400).json({ error: 'Geçersiz kanal adı.' });
    }
    if (!participant || participant.length > 64) {
      return res.status(400).json({ error: 'Geçersiz kullanıcı adı.' });
    }
    if (!safeEqual(roomPassword, process.env.ROOM_PASSWORD)) {
      return res.status(401).json({ error: 'Kanal parolası hatalı.' });
    }
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: participant,
      name: participant,
      ttl: '10m'
    });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
    const token = await at.toJwt();
    return res.json({ token, url: livekitUrl, room, identity: participant, expiresIn: 600 });
  } catch (err) {
    console.error('Token generation failed:', err);
    return res.status(500).json({ error: 'Token üretilemedi.' });
  }
});
app.listen(port, '0.0.0.0', () => console.log(`PMR LiveKit Cloud token API listening on ${port}`));
