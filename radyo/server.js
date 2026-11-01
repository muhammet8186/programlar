'use strict';
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const dns = require('dns').promises;
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.RECORD_API_KEY;
if (!API_KEY || API_KEY.length < 24) {
  console.error('RECORD_API_KEY ortam değişkeni en az 24 karakter olmalıdır.');
  process.exit(1);
}
app.use(cors({ origin: true, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '16kb' }));

let active = null;
const tmpRoot = path.join(os.tmpdir(), 'online-radyo-recordings');
fs.mkdirSync(tmpRoot, { recursive: true });

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== API_KEY) return res.status(401).json({ error: 'API anahtarı geçersiz.' });
  next();
}
function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const p = address.split('.').map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }
  if (net.isIPv6(address)) {
    const a = address.toLowerCase();
    return a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80:') || a.startsWith('::ffff:127.') || a.startsWith('::ffff:10.');
  }
  return true;
}
async function validateStreamUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('Geçerli bir yayın adresi girilmedi.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Yalnızca HTTP veya HTTPS yayın adresleri desteklenir.');
  if (u.username || u.password) throw new Error('Kullanıcı adı/parola içeren yayın adresleri desteklenmiyor.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Bu sunucu adresine izin verilmiyor.');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Özel ağ adreslerine izin verilmiyor.');
  } else {
    const addresses = await dns.lookup(host, { all: true });
    if (!addresses.length || addresses.some(x => isPrivateAddress(x.address))) throw new Error('Yayın adresi güvenli bir genel IP adresine çözülmedi.');
  }
  return u.href;
}
function cleanupSession(s) {
  if (!s) return;
  try { if (fs.existsSync(s.file)) fs.unlinkSync(s.file); } catch {}
}
app.get('/health', (req, res) => res.json({ ok: true, service: 'online-radio-recorder', recording: !!active }));
app.post('/api/record/start', auth, async (req, res) => {
  if (active) return res.status(409).json({ error: 'Başka bir kayıt zaten devam ediyor.' });
  try {
    const streamUrl = await validateStreamUrl(String(req.body.streamUrl || ''));
    const stationName = String(req.body.stationName || 'Radyo Kaydı').slice(0, 100);
    const id = crypto.randomUUID();
    const file = path.join(tmpRoot, `${id}.mp3`);
    const args = ['-hide_banner','-loglevel','error','-nostdin','-y','-reconnect','1','-reconnect_streamed','1','-reconnect_delay_max','5','-i',streamUrl,'-vn','-ac','2','-ar','44100','-c:a','libmp3lame','-b:a','128k','-f','mp3',file];
    const child = spawn('ffmpeg', args, { stdio: ['ignore','ignore','pipe'] });
    const session = { id, file, stationName, child, startedAt: Date.now(), stderr: '' };
    active = session;
    child.stderr.on('data', d => { session.stderr = (session.stderr + d.toString()).slice(-3000); });
    child.on('error', err => { session.error = err.message; });
    child.on('exit', (code, signal) => { session.exit = { code, signal }; });
    await new Promise(r => setTimeout(r, 1400));
    if (child.exitCode !== null || session.error) {
      active = null; cleanupSession(session);
      return res.status(502).json({ error: 'Radyo yayını başlatılamadı. Yayın bağlantısını kontrol edin.', detail: session.stderr.slice(-700) });
    }
    res.json({ ok: true, id, stationName, startedAt: session.startedAt });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Kayıt başlatılamadı.' });
  }
});
app.get('/api/record/status', auth, (req, res) => {
  if (!active) return res.json({ recording: false });
  if (active.child.exitCode !== null || active.error) return res.status(409).json({ recording: false, error: active.stderr.slice(-500) || active.error || 'Yayın bağlantısı kesildi.' });
  res.json({ recording: true, startedAt: active.startedAt, elapsedSeconds: Math.floor((Date.now() - active.startedAt) / 1000) });
});
app.post('/api/record/stop', auth, async (req, res) => {
  const s = active;
  if (!s) return res.status(404).json({ error: 'Aktif kayıt bulunamadı.' });
  active = null;
  if (s.child.exitCode === null) s.child.kill('SIGINT');
  await new Promise(resolve => {
    if (s.child.exitCode !== null) return resolve();
    const timer = setTimeout(() => { if (s.child.exitCode === null) s.child.kill('SIGKILL'); resolve(); }, 9000);
    s.child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  try {
    const stat = fs.existsSync(s.file) ? fs.statSync(s.file) : null;
    if (!stat || stat.size < 1024) {
      cleanupSession(s);
      return res.status(422).json({ error: 'Kayıt dosyası boş. Radyo yayını erişilemiyor olabilir.', detail: s.stderr.slice(-700) });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="radio-recording-${Date.now()}.mp3"`);
    res.setHeader('Content-Length', stat.size);
    const input = fs.createReadStream(s.file);
    input.on('error', () => { if (!res.headersSent) res.status(500); res.end(); cleanupSession(s); });
    res.on('finish', () => cleanupSession(s));
    res.on('close', () => cleanupSession(s));
    input.pipe(res);
  } catch (err) {
    cleanupSession(s);
    if (!res.headersSent) res.status(500).json({ error: 'Kayıt dosyası hazırlanamadı.' });
  }
});
app.listen(PORT, '0.0.0.0', () => console.log(`Online Radyo kayıt sunucusu ${PORT} portunda hazır.`));
