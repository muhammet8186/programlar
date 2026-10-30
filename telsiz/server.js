import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { AccessToken } from 'livekit-server-sdk';

const app = express();
app.use(express.json({ limit: '16kb' }));
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(x => x.trim());
app.use(cors({ origin: (origin, cb) => {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
  return cb(new Error('Origin not allowed'));
} }));

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, PORT = 3000, ROOM_PASSWORD } = process.env;
if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('LIVEKIT_URL, LIVEKIT_API_KEY ve LIVEKIT_API_SECRET zorunludur.');
  process.exit(1);
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'pmr-livekit-token' }));

app.post('/api/livekit-token', async (req, res) => {
  try {
    const room = String(req.body?.room || '').trim().toLowerCase();
    const identity = String(req.body?.identity || '').trim();
    const password = String(req.body?.password || '');
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(room)) return res.status(400).json({ error: 'Geçersiz oda adı.' });
    if (!identity || identity.length > 48) return res.status(400).json({ error: 'Geçersiz kullanıcı adı.' });
    // İsteğe bağlı tek ortak oda parolası. Boş bırakılırsa uygulamanın mevcut PeerJS
    // oda doğrulaması ön kapı olarak kalır; üretimde gerçek kimlik doğrulama ekleyin.
    if (ROOM_PASSWORD && password !== ROOM_PASSWORD) return res.status(403).json({ error: 'Oda parolası hatalı.' });

    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: identity,
      ttl: '2h'
    });
    token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: false });
    const jwt = await token.toJwt();
    return res.json({ serverUrl: LIVEKIT_URL, token: jwt });
  } catch (error) {
    console.error('Token üretme hatası:', error);
    return res.status(500).json({ error: 'Token üretilemedi.' });
  }
});

app.listen(Number(PORT), '0.0.0.0', () => console.log(`PMR LiveKit token API ${PORT} portunda hazır.`));
