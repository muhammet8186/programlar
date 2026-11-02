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
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://muhammet8186.github.io';
const PLAYLIST_URL = process.env.PLAYLIST_URL || 'https://raw.githubusercontent.com/muhammet8186/programlar/main/radyo/radyo.m3u';
const MAX_RECORD_MS = 30 * 60 * 1000; // en fazla 30 dakika
const STARTS_PER_HOUR = 5;
const tmpRoot = path.join(os.tmpdir(), 'online-radio-recordings');
fs.mkdirSync(tmpRoot, { recursive: true });

app.set('trust proxy', 1);
app.use(cors({
  origin: APP_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  maxAge: 600
}));
app.use(express.json({ limit: '8kb' }));

let active = null;
let allowedStreams = new Set();
let playlistLoadedAt = 0;
let playlistLoadPromise = null;
const startHistory = new Map();

function clientIp(req) {
  return String(req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}
function requireAppOrigin(req, res, next) {
  if (req.get('origin') !== APP_ORIGIN) return res.status(403).json({ error: 'Bu uygulama kaynağına izin verilmiyor.' });
  next();
}
function allowStartRate(ip) {
  const now = Date.now();
  const recent = (startHistory.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);
  if (recent.length >= STARTS_PER_HOUR) {
    startHistory.set(ip, recent);
    return false;
  }
  recent.push(now);
  startHistory.set(ip, recent);
  if (startHistory.size > 5000) {
    for (const [key, times] of startHistory) {
      if (!times.some(t => now - t < 60 * 60 * 1000)) startHistory.delete(key);
    }
  }
  return true;
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
    return a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80:') ||
      a.startsWith('::ffff:127.') || a.startsWith('::ffff:10.') || a.startsWith('::ffff:192.168.');
  }
  return true;
}
function normalizeUrl(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Yayın adresi geçersiz.');
  return u.href;
}
async function refreshAllowedStreams(force = false) {
  if (!force && allowedStreams.size && Date.now() - playlistLoadedAt < 10 * 60 * 1000) return allowedStreams;
  if (playlistLoadPromise) return playlistLoadPromise;
  playlistLoadPromise = (async () => {
    const response = await fetch(PLAYLIST_URL, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'OnlineRadyoRecorder/1.0' } });
    if (!response.ok) throw new Error('Radyo listesi sunucudan alınamadı.');
    const body = await response.text();
    const next = new Set();
    for (const line of body.split(/\r?\n/)) {
      const value = line.trim();
      if (!/^https?:\/\//i.test(value)) continue;
      try { next.add(normalizeUrl(value)); } catch {}
    }
    if (!next.size) throw new Error('Onaylı radyo listesinde yayın bulunamadı.');
    allowedStreams = next;
    playlistLoadedAt = Date.now();
    return allowedStreams;
  })();
  try { return await playlistLoadPromise; }
  finally { playlistLoadPromise = null; }
}
async function validateStreamUrl(value) {
  let normalized;
  try { normalized = normalizeUrl(String(value || '')); }
  catch { throw new Error('Geçerli bir HTTP/HTTPS yayın adresi girin.'); }
  const approved = await refreshAllowedStreams();
  if (!approved.has(normalized)) throw new Error('Bu yayın güvenlik nedeniyle kayıt için onaylı listede bulunmuyor. Ana GitHub radyo listesindeki bir kanalı seçin.');
  const u = new URL(normalized);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Yerel ağ adreslerine izin verilmiyor.');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Özel ağ adreslerine izin verilmiyor.');
  } else {
    const addresses = await dns.lookup(host, { all: true });
    if (!addresses.length || addresses.some(x => isPrivateAddress(x.address))) throw new Error('Yayın adresi güvenli bir genel IP adresine çözülmedi.');
  }
  return normalized;
}
function cleanupSession(s) {
  if (!s) return;
  if (s.maxTimer) clearTimeout(s.maxTimer);
  try { if (fs.existsSync(s.file)) fs.unlinkSync(s.file); } catch {}
}
function stopChild(s) {
  if (!s || s.child.exitCode !== null) return;
  try { s.child.kill('SIGINT'); } catch {}
  setTimeout(() => { if (s.child.exitCode === null) { try { s.child.kill('SIGKILL'); } catch {} } }, 7000).unref();
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'online-radio-recorder', recording: !!active }));

app.post('/api/record/start', requireAppOrigin, async (req, res) => {
  const ip = clientIp(req);
  if (!allowStartRate(ip)) return res.status(429).json({ error: 'Saatlik kayıt başlatma sınırına ulaştınız. Bir süre sonra tekrar deneyin.' });
  if (active) return res.status(409).json({ error: 'Şu anda başka bir kayıt devam ediyor. Lütfen biraz sonra tekrar deneyin.' });
  let session;
  try {
    const streamUrl = await validateStreamUrl(req.body.streamUrl);
    const stationName = String(req.body.stationName || 'Radyo Kaydı').slice(0, 100);
    const id = crypto.randomUUID();
    const file = path.join(tmpRoot, `${id}.mp3`);
    const args = ['-hide_banner','-loglevel','error','-nostdin','-y','-reconnect','1','-reconnect_streamed','1','-reconnect_delay_max','5','-i',streamUrl,'-t',String(MAX_RECORD_MS / 1000),'-vn','-ac','2','-ar','44100','-c:a','libmp3lame','-b:a','128k','-f','mp3',file];
    const child = spawn('ffmpeg', args, { stdio: ['ignore','ignore','pipe'] });
    session = { id, file, stationName, child, ownerIp: ip, startedAt: Date.now(), stderr: '' };
    active = session;
    child.stderr.on('data', d => { session.stderr = (session.stderr + d.toString()).slice(-2500); });
    child.on('error', err => { session.error = err.message; });
    child.on('close', (code, signal) => { session.exit = { code, signal }; });
    session.maxTimer = setTimeout(() => {
      if (active === session) active = null;
      stopChild(session);
      setTimeout(() => cleanupSession(session), 9000).unref();
    }, MAX_RECORD_MS);
    await new Promise(resolve => setTimeout(resolve, 1400));
    if (child.exitCode !== null || session.error) {
      if (active === session) active = null;
      cleanupSession(session);
      return res.status(502).json({ error: 'Radyo yayını başlatılamadı. Yayın bağlantısını kontrol edin.', detail: session.stderr.slice(-500) });
    }
    res.json({ ok: true, id, stationName, startedAt: session.startedAt, maxDurationMinutes: 30 });
  } catch (err) {
    if (session && active === session) active = null;
    cleanupSession(session);
    res.status(400).json({ error: err.message || 'Kayıt başlatılamadı.' });
  }
});

app.get('/api/record/status', requireAppOrigin, (req, res) => {
  if (!active) return res.json({ recording: false });
  if (active.ownerIp !== clientIp(req)) return res.status(403).json({ error: 'Bu kayıt başka bir kullanıcıya ait.' });
  if (active.child.exitCode !== null || active.error) {
    const s = active; active = null; cleanupSession(s);
    return res.status(409).json({ recording: false, error: s.stderr.slice(-400) || s.error || 'Yayın bağlantısı kesildi.' });
  }
  res.json({ recording: true, startedAt: active.startedAt, elapsedSeconds: Math.floor((Date.now() - active.startedAt) / 1000), maxDurationMinutes: 30 });
});

app.post('/api/record/stop', requireAppOrigin, async (req, res) => {
  const s = active;
  if (!s) return res.status(404).json({ error: 'Aktif kayıt bulunamadı. Kayıt süresi dolmuş olabilir.' });
  if (s.ownerIp !== clientIp(req)) return res.status(403).json({ error: 'Bu kayıt başka bir kullanıcıya ait.' });
  active = null;
  stopChild(s);
  await new Promise(resolve => {
    if (s.child.exitCode !== null) return resolve();
    const timer = setTimeout(resolve, 8500);
    s.child.once('close', () => { clearTimeout(timer); resolve(); });
  });
  try {
    const stat = fs.existsSync(s.file) ? fs.statSync(s.file) : null;
    if (!stat || stat.size < 1024) {
      cleanupSession(s);
      return res.status(422).json({ error: 'Kayıt dosyası boş. Radyo yayını erişilemiyor olabilir.' });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="online-radyo-${Date.now()}.mp3"`);
    res.setHeader('Content-Length', stat.size);
    const input = fs.createReadStream(s.file);
    input.on('error', () => { if (!res.headersSent) res.status(500); res.end(); cleanupSession(s); });
    res.on('finish', () => cleanupSession(s));
    res.on('close', () => cleanupSession(s));
    input.pipe(res);
  } catch {
    cleanupSession(s);
    if (!res.headersSent) res.status(500).json({ error: 'Kayıt dosyası hazırlanamadı.' });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Online Radyo güvenli kayıt sunucusu ${PORT} portunda hazır. Uygulama: ${APP_ORIGIN}`));
