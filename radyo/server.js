const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); }
catch (err) { console.error('ffmpeg-static yüklenemedi; yayın köprüsü çalışabilir ancak sunucu tarafı kayıt devre dışı:', err.message); }

const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERSION = '3.5.4';
const MAX_REDIRECTS = 5;
const MAX_RECORD_MS = 30 * 60 * 1000;
const allowedHosts = (process.env.STREAM_PROXY_ALLOWED_HOSTS || 'sslyayin.netyayin.net').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const recordAllowedHosts = (process.env.RECORD_ALLOWED_HOSTS || process.env.STREAM_PROXY_ALLOWED_HOSTS || 'sslyayin.netyayin.net').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const dataDir = process.env.RECORDINGS_DIR || (process.env.RENDER_DISK_PATH ? path.join(process.env.RENDER_DISK_PATH, 'recordings') : path.join(__dirname, 'recordings'));
fs.mkdirSync(dataDir, { recursive: true });
let activeRecording = null;
let lastRecording = null;

app.use(cors({ origin: '*', methods: ['GET','HEAD','POST','OPTIONS'], allowedHeaders: ['Range','Icy-MetaData','Content-Type'], exposedHeaders: ['Content-Length','Content-Range','Accept-Ranges','Content-Type','Icy-MetaInt','Icy-Name','Icy-Br'] }));
app.use(express.json({ limit: '32kb' }));

app.get('/', (req,res) => res.json({ ok:true, service:'Online Radyo Sunucusu', version:VERSION, streamProxy:true, serverRecording:!!ffmpegPath, ffmpeg:!!ffmpegPath }));
app.get('/health', (req,res) => res.json({ ok:true, status:'running', version:VERSION, serverRecording:!!ffmpegPath, recording:!!activeRecording, finishedRecording:!!lastRecording }));

function hostAllowed(url, list) {
  if (!['http:','https:'].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  return list.some(rule => rule === '*' || rule === host || (rule.startsWith('*.') && host.endsWith(rule.slice(1))));
}
function isAllowed(url) { return hostAllowed(url, allowedHosts); }
function requestStream(target, headers, method, res, redirectCount) {
  if (res.destroyed || res.writableEnded) return;
  if (!isAllowed(target)) return !res.headersSent && res.status(403).json({ error:'Yönlendirilen sunucu izin listesinde değil', redirectHost:target.hostname });
  if (redirectCount > MAX_REDIRECTS) return !res.headersSent && res.status(508).json({ error:'Çok fazla yönlendirme' });
  const client = target.protocol === 'https:' ? https : http;
  const proxyRequest = client.request(target, { method, headers, timeout:30000 }, upstream => {
    const status = upstream.statusCode || 200;
    if ([301,302,303,307,308].includes(status)) {
      const location = upstream.headers.location; upstream.resume();
      if (!location) return !res.headersSent && res.status(502).json({ error:'Yönlendirme adresi bulunamadı' });
      let nextUrl; try { nextUrl = new URL(location,target); } catch { return !res.headersSent && res.status(502).json({ error:'Yönlendirme adresi geçersiz' }); }
      if (!isAllowed(nextUrl)) return !res.headersSent && res.status(403).json({ error:'Yönlendirilen sunucu izin listesinde değil', redirectHost:nextUrl.hostname });
      const nextHeaders = { ...headers }; delete nextHeaders.Authorization; delete nextHeaders.authorization; delete nextHeaders.Cookie; delete nextHeaders.cookie;
      return requestStream(nextUrl,nextHeaders,method,res,redirectCount+1);
    }
    res.status(status);
    ['content-type','content-length','content-range','accept-ranges','icy-metaint','icy-name','icy-br'].forEach(k => { if (upstream.headers[k]) res.setHeader(k,upstream.headers[k]); });
    res.setHeader('Cache-Control','no-cache, no-store');
    upstream.on('error',err => { console.error('Kaynak yayın hatası:',err.message); if (!res.destroyed) res.destroy(err); });
    upstream.pipe(res);
    res.on('close',() => { if (!upstream.destroyed) upstream.destroy(); });
  });
  proxyRequest.on('timeout',() => proxyRequest.destroy(new Error('Yayın zaman aşımı')));
  proxyRequest.on('error',err => { console.error('Yayın köprüsü hatası:',err.message); if (!res.headersSent && !res.destroyed) res.status(502).json({ error:'Yayın kaynağına bağlanılamadı', detail:err.message }); else if (!res.destroyed) res.destroy(err); });
  res.on('close',() => { if (!proxyRequest.destroyed) proxyRequest.destroy(); });
  proxyRequest.end();
}
app.all('/stream',(req,res) => {
  if (!['GET','HEAD'].includes(req.method)) return res.status(405).json({ error:'Method not allowed' });
  if (!req.query.url) return res.status(400).json({ error:'Yayın adresi eksik' });
  let target; try { target = new URL(req.query.url); } catch { return res.status(400).json({ error:'Geçersiz yayın adresi' }); }
  if (!isAllowed(target)) return res.status(403).json({ error:'Bu yayın adresine izin verilmiyor', host:target.hostname });
  const headers = { 'User-Agent':'Mozilla/5.0 OnlineRadio/3.3', 'Accept':'*/*', 'Icy-MetaData':req.headers['icy-metadata'] || '0' };
  if (req.headers.range) headers.Range = req.headers.range;
  requestStream(target,headers,req.method,res,0);
});

function normalizeRecordStreamUrl(input) {
  const target = new URL(input);
  // Bu SHOUTcast sunucusunda ana dizin sayfası yerine gerçek ses mount noktası /; kullanılır.
  if (target.hostname.toLowerCase() === 'sslyayin.netyayin.net' &&
      (target.pathname === '/' || target.pathname === '') && !target.search) {
    target.pathname = '/;';
  }
  return target;
}

function safeName(value) {
  return String(value || 'Radyo Kaydı').normalize('NFKD').replace(/[^a-zA-Z0-9-_ ]/g,'').trim().replace(/\s+/g,'_').slice(0,60) || 'Radyo_Kaydi';
}
function finishRecording(reason='stopped') {
  if (!activeRecording) return Promise.resolve(null);
  const rec = activeRecording;
  if (rec.finishPromise) return rec.finishPromise;
  rec.finishPromise = new Promise(resolve => {
    const done = () => { if (activeRecording === rec) activeRecording = null; resolve(rec.filePath); };
    rec.proc.once('close', () => done());
    // SIGINT, FFmpeg'in MP3 kapsayıcısını düzgün kapatıp dosyayı finalize etmesini sağlar.
    try { if (!rec.proc.killed) rec.proc.kill('SIGINT'); } catch (_) {}
    const killTimer = setTimeout(() => { if (!rec.proc.killed) rec.proc.kill('SIGKILL'); }, 8000);
    rec.proc.once('close', () => clearTimeout(killTimer));
    rec.reason = reason;
  });
  return rec.finishPromise;
}
function waitForAudioFile(rec, timeoutMs=15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      let size = 0;
      try { if (fs.existsSync(rec.filePath)) size = fs.statSync(rec.filePath).size; } catch (_) {}
      if (size >= 4096) return resolve(size);
      if (rec.finished) return reject(new Error(rec.stderr || rec.error || `FFmpeg yayın bağlantısını kuramadı (çıkış kodu: ${rec.exitCode ?? 'bilinmiyor'}).`));
      if (Date.now() - started >= timeoutMs) return reject(new Error(rec.stderr || '25 saniye içinde yayın ses verisi alınamadı. FFmpeg çıktısını Render Logs bölümünden kontrol edin.'));
      setTimeout(check, 300);
    };
    check();
  });
}
app.post('/api/record/start',async(req,res) => {
  if (!ffmpegPath) return res.status(503).json({ error:'FFmpeg bu sunucuda bulunamadı.' });
  if (activeRecording) return res.status(409).json({ error:'Sunucuda zaten devam eden bir kayıt var.' });
  const { streamUrl, stationName } = req.body || {};
  let target; try { target = normalizeRecordStreamUrl(streamUrl); } catch { return res.status(400).json({ error:'Geçerli yayın adresi gönderilmedi.' }); }
  if (!hostAllowed(target,recordAllowedHosts)) return res.status(403).json({ error:`Bu kanalın sunucuda kaydına izin verilmiyor: ${target.hostname}. Render RECORD_ALLOWED_HOSTS ayarını kontrol edin.` });
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const fileName = `${stamp}_${safeName(stationName)}.mp3`;
  const filePath = path.join(dataDir,fileName);
  console.log('Sunucu kaydı başlatılıyor:', target.hostname + target.pathname, 'İstasyon:', String(stationName || 'Radyo Kaydı').slice(0,120));
  const args = ['-hide_banner','-loglevel','warning','-nostats','-y','-user_agent','Mozilla/5.0 OnlineRadioRecorder/3.5.4','-rw_timeout','25000000','-reconnect','1','-reconnect_streamed','1','-reconnect_delay_max','5','-i',target.href,'-vn','-codec:a','libmp3lame','-b:a','128k','-f','mp3',filePath];
  const proc = spawn(ffmpegPath,args,{ stdio:['ignore','ignore','pipe'] });
  const rec = { proc,filePath,fileName,stationName:String(stationName || 'Radyo Kaydı').slice(0,120),startedAt:Date.now(),stderr:'',finished:false,stopRequested:false };
  lastRecording = null;
  activeRecording = rec;
  proc.stderr.on('data',d => { rec.stderr = (rec.stderr + d.toString()).slice(-5000); });
  proc.once('error',err => { console.error('FFmpeg başlatılamadı:',err); rec.error = err.message; rec.finished = true; rec.closedAt = Date.now(); lastRecording = rec; if (activeRecording === rec) activeRecording = null; });
  proc.once('close',(code,signal) => {
    rec.exitCode = code; rec.signal = signal; rec.finished = true; rec.closedAt = Date.now();
    if (rec.maxTimer) clearTimeout(rec.maxTimer);
    lastRecording = rec; if (activeRecording === rec) activeRecording = null;
    if (code !== 0 && !rec.stopRequested) console.error('FFmpeg kayıt hatası:',rec.stderr);
  });
  rec.maxTimer = setTimeout(() => { if (activeRecording === rec) finishRecording('maximum-duration').catch(console.error); },MAX_RECORD_MS);
  try {
    const bytes = await waitForAudioFile(rec,25000);
    // FFmpeg bağlantıdan sonra kapanmış olsa bile yeterli MP3 verisi varsa
    // kaydı kullanıcıya teslim edebiliriz.
    return res.json({ ok:true,recording:true,audioConfirmed:true,bytes,stationName:rec.stationName,maxDurationMinutes:30 });
  } catch(err) {
    if (rec.maxTimer) clearTimeout(rec.maxTimer);
    if (activeRecording === rec) {
      rec.stopRequested = true;
      try { await finishRecording('start-failed'); } catch (_) {}
    }
    if (lastRecording === rec) lastRecording = null;
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    return res.status(502).json({ error:'Kayıt başlatılamadı: sunucudan yayın sesi alınamadı.', detail:err.message });
  }
});
app.get('/api/record/status',(req,res) => { const rec = activeRecording || lastRecording; res.json({ ok:true,recording:!!activeRecording,finished:!!rec?.finished,hasFile:!!(rec && fs.existsSync(rec.filePath)),fileBytes:(rec && fs.existsSync(rec.filePath) ? fs.statSync(rec.filePath).size : 0),stationName:rec?.stationName || null,startedAt:rec?.startedAt || null,elapsedSeconds:rec ? Math.floor(((rec.closedAt || Date.now())-rec.startedAt)/1000) : 0,error:rec?.error || (rec?.exitCode && rec.exitCode !== 0 ? rec.stderr : null) }); });
app.post('/api/record/stop',async(req,res) => {
  // FFmpeg yayın hatasıyla kendiliğinden kapansa bile son kaydı teslim etmeyi dene.
  const rec = activeRecording || lastRecording;
  if (!rec) return res.status(409).json({ error:'Sunucuda alınabilecek aktif veya tamamlanmış kayıt bulunamadı. Kayıt başlatma isteği aynı sunucu örneğine ulaşmamış olabilir.' });
  if (rec.maxTimer) clearTimeout(rec.maxTimer);
  try {
    if (activeRecording === rec) {
      rec.stopRequested = true;
      await finishRecording('user-stop');
    }
    if (!fs.existsSync(rec.filePath) || fs.statSync(rec.filePath).size < 1024) {
      const detail = rec.stderr || rec.error || (rec.exitCode !== undefined ? `FFmpeg çıkış kodu: ${rec.exitCode}` : 'Kayıt dosyası boş veya henüz oluşmamış');
      try { if (fs.existsSync(rec.filePath)) fs.unlinkSync(rec.filePath); } catch (_) {}
      if (lastRecording === rec) lastRecording = null;
      return res.status(502).json({ error:'Kayıt dosyası oluşmadı. Yayın adresi sunucuda okunamamış olabilir.', detail });
    }
    res.setHeader('Content-Type','audio/mpeg');
    res.setHeader('Content-Disposition',`attachment; filename="${rec.fileName}"`);
    res.setHeader('Cache-Control','no-store');
    const input = fs.createReadStream(rec.fil