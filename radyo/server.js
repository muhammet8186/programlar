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
const MAX_ACTIVE = 100;
const MAX_RECORDING_MS = 30 * 60 * 1000;
const MAX_STARTS_PER_HOUR = 5;
const COMPLETED_TTL_MS = 15 * 60 * 1000;
app.set('trust proxy', 1);
app.use(cors({ origin: true, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','X-Device-ID'] }));
app.use(express.json({ limit: '16kb' }));

const sessions = new Map();
const startHistory = new Map();
const tmpRoot = path.join(os.tmpdir(), 'online-radyo-recordings');
fs.mkdirSync(tmpRoot, { recursive: true });

function clientKey(req) {
  const device = String(req.get('X-Device-ID') || '').slice(0, 100);
  if (!/^[a-zA-Z0-9._:-]{12,100}$/.test(device)) throw new Error('Cihaz kimliği eksik. Sayfayı yenileyip tekrar deneyin.');
  return crypto.createHash('sha256').update(`${req.ip}|${device}`).digest('hex');
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
    return a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') ||
      a.startsWith('fe80:') || a.startsWith('::ffff:127.') || a.startsWith('::ffff:10.');
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
function removeSession(s) {
  if (!s) return;
  sessions.delete(s.id);
  try { if (fs.existsSync(s.file)) fs.unlinkSync(s.file); } catch {}
}
function activeCount() {
  let n = 0;
  for (const s of sessions.values()) if (s.state === 'recording') n++;
  return n;
}
function finishRecording(s, reason) {
  if (!s || s.state !== 'recording') return;
  s.state = 'completed';
  s.completedAt = Date.now();
  s.reason = reason || 'Kayıt tamamlandı.';
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
}
function stopChild(s, signal = 'SIGINT') {
  return new Promise(resolve => {
    if (!s.child || s.child.exitCode !== null) return resolve();
    s.child.kill(signal);
    const timer = setTimeout(() => {
      if (s.child.exitCode === null) s.child.kill('SIGKILL');
      resolve();
    }, 9000);
    s.child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.state === 'recording' && now - s.startedAt >= MAX_RECORDING_MS) {
      finishRecording(s, '30 dakikalık kayıt süresi doldu.');
      stopChild(s).catch(() => {});
    } else if (s.state !== 'recording' && s.completedAt && now - s.completedAt > COMPLETED_TTL_MS) {
      removeSession(s);
    }
  }
  for (const [key, times] of startHistory) {
    const recent = times.filter(t => now - t < 60 * 60 * 1000);
    if (recent.length) startHistory.set(key, recent); else startHistory.delete(key);
  }
}, 30 * 1000).unref();

app.get('/health', (req, res) => res.json({
  ok: true, service: 'online-radio-recorder',
  activeRecordings: activeCount(), maxConcurrentRecordings: MAX_ACTIVE
}));

app.post('/api/record/start', async (req, res) => {
  let key;
  try {
    key = clientKey(req);
    const now = Date.now();
    const starts = (startHistory.get(key) || []).filter(t => now - t < 60 * 60 * 1000);
    if (starts.length >= MAX_STARTS_PER_HOUR) {
      return res.status(429).json({ error: 'Saatlik kayıt başlatma sınırına ulaştınız. Bir saat içinde en fazla 5 kayıt başlatabilirsiniz.' });
    }
    const streamUrl = await validateStreamUrl(String(req.body.streamUrl || ''));
    if (activeCount() >= MAX_ACTIVE) {
      return res.status(503).json({ error: 'Kayıt sunucusu şu anda dolu. En fazla 100 kişi aynı anda kayıt yapabilir. Lütfen daha sonra tekrar deneyin.' });
    }
    if ([...sessions.values()].some(s => s.owner === key && s.state === 'recording')) {
      return res.status(409).json({ error: 'Zaten devam eden bir kaydınız var. Önce mevcut kaydı bitirin.' });
    }
    const id = crypto.randomUUID();
    const stationName = String(req.body.stationName || 'Radyo Kaydı').slice(0, 100);
    const file = path.join(tmpRoot, `${id}.mp3`);
    const args = ['-hide_banner','-loglevel','error','-nostdin','-y','-reconnect','1','-reconnect_streamed','1','-reconnect_delay_max','5','-i',streamUrl,'-vn','-ac','2','-ar','44100','-c:a','libmp3lame','-b:a','128k','-f','mp3',file];
    const child = spawn('ffmpeg', args, { stdio: ['ignore','ignore','pipe'] });
    const session = { id, owner: key, file, stationName, child, startedAt: now, stderr: '', state: 'recording', timer: null };
    sessions.set(id, session);
    starts.push(now); startHistory.set(key, starts);
    child.stderr.on('data', d => { session.stderr = (session.stderr + d.toString()).slice(-3000); });
    child.on('error', err => { session.error = err.message; finishRecording(session, 'Kayıt işlemi başlatılamadı.'); });
    child.on('exit', (code, signal) => {
      session.exit = { code, signal };
      if (session.state === 'recording') finishRecording(session, 'Radyo yayını sona erdi.');
    });
    session.timer = setTimeout(() => {
      finishRecording(session, '30 dakikalık kayıt süresi doldu.');
      stopChild(session).catch(() => {});
    }, MAX_RECORDING_MS);
    await new Promise(r => setTimeout(r, 1400));
    if (child.exitCode !== null || session.error) {
      removeSession(session);
      return res.status(502).json({ error: 'Radyo yayını başlatılamadı. Yayın bağlantısını kontrol edin.', detail: session.stderr.slice(-700) });
    }
    res.json({ ok: true, id, stationName, startedAt: session.startedAt, maxDurationSeconds: 1800 });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Kayıt başlatılamadı.' });
  }
});

app.get('/api/record/status', (req, res) => {
  try {
    const key = clientKey(req);
    const s = sessions.get(String(req.query.id || ''));
    if (!s || s.owner !== key) return res.status(404).json({ recording: false, error: 'Kayıt oturumu bulunamadı.' });
    res.json({
      recording: s.state === 'recording',
      completed: s.state !== 'recording',
      reason: s.reason || null,
      startedAt: s.startedAt,
      elapsedSeconds: Math.floor((Date.now() - s.startedAt) / 1000)
    });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/record/stop', async (req, res) => {
  let s;
  try {
    const key = clientKey(req);
    s = sessions.get(String(req.body.id || ''));
    if (!s || s.owner !== key) return res.status(404).json({ error: 'Kayıt oturumu bulunamadı veya size ait değil.' });
    if (s.state === 'recording') finishRecording(s, 'Kullanıcı kaydı durdurdu.');
    await stopChild(s);
    const stat = fs.existsSync(s.file) ? fs.statSync(s.file) : null;
    if (!stat || stat.size < 1024) {
      removeSession(s);
      return res.status(422).json({ error: 'Kayıt dosyası boş. Radyo yayını erişilemiyor olabilir.', detail: s.stderr.slice(-700) });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="radio-recording-${Date.now()}.mp3"`);
    res.setHeader('Content-Length', stat.size);
    const input = fs.createReadStream(s.file);
    input.on('error', () => { if (!res.headersSent) res.status(500); res.end(); removeSession(s); });
    res.on('finish', () => removeSession(s));
    res.on('close', () => removeSession(s));
    input.pipe(res);
  } catch (err) {
    if (s) removeSession(s);
    if (!res.headersSent) res.status(400).json({ error: err.message || 'Kayıt dosyası hazırlanamadı.' });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Online Radyo kayıt sunucusu ${PORT} portunda hazır.`));
