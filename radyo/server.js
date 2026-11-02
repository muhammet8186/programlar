const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_REDIRECTS = 5;
const MAX_RECORD_MS = 30 * 60 * 1000;
const allowedHosts = (process.env.STREAM_PROXY_ALLOWED_HOSTS || 'sslyayin.netyayin.net').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const recordAllowedHosts = (process.env.RECORD_ALLOWED_HOSTS || process.env.STREAM_PROXY_ALLOWED_HOSTS || 'sslyayin.netyayin.net').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const dataDir = process.env.RECORDINGS_DIR || (process.env.RENDER_DISK_PATH ? path.join(process.env.RENDER_DISK_PATH, 'recordings') : path.join(__dirname, 'recordings'));
fs.mkdirSync(dataDir, { recursive: true });
let activeRecording = null;

app.use(cors({ origin: '*', methods: ['GET','HEAD','POST','OPTIONS'], allowedHeaders: ['Range','Icy-MetaData','Content-Type'], exposedHeaders: ['Content-Length','Content-Range','Accept-Ranges','Content-Type','Icy-MetaInt','Icy-Name','Icy-Br'] }));
app.use(express.json({ limit: '32kb' }));

app.get('/', (req,res) => res.json({ ok:true, service:'Online Radyo Sunucusu', version:'3.3', streamProxy:true, serverRecording:true, ffmpeg:!!ffmpegPath }));
app.get('/health', (req,res) => res.json({ ok:true, status:'running', version:'3.3', serverRecording:true, recording:!!activeRecording }));

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
app.post('/api/record/start',(req,res) => {
  if (!ffmpegPath) return res.status(503).json({ error:'FFmpeg bu sunucuda bulunamadı.' });
  if (activeRecording) return res.status(409).json({ error:'Sunucuda zaten devam eden bir kayıt var.' });
  const { streamUrl, stationName } = req.body || {};
  let target; try { target = new URL(streamUrl); } catch { return res.status(400).json({ error:'Geçerli yayın adresi gönderilmedi.' }); }
  if (!hostAllowed(target,recordAllowedHosts)) return res.status(403).json({ error:`Bu kanalın sunucuda kaydına izin verilmiyor: ${target.hostname}. Render RECORD_ALLOWED_HOSTS ayarına bu alan adını ekleyin.` });
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const fileName = `${stamp}_${safeName(stationName)}.mp3`;
  const filePath = path.join(dataDir,fileName);
  const args = ['-hide_banner','-loglevel','error','-y','-user_agent','Mozilla/5.0 OnlineRadioRecorder/3.3','-i',target.href,'-vn','-codec:a','libmp3lame','-b:a','128k','-f','mp3',filePath];
  const proc = spawn(ffmpegPath,args,{ stdio:['ignore','ignore','pipe'] });
  const rec = { proc,filePath,fileName,stationName:String(stationName || 'Radyo Kaydı').slice(0,120),startedAt:Date.now(),stderr:'' };
  activeRecording = rec;
  proc.stderr.on('data',d => { rec.stderr = (rec.stderr + d.toString()).slice(-4000); });
  proc.once('error',err => { console.error('FFmpeg başlatılamadı:',err); if (activeRecording === rec) activeRecording = null; });
  proc.once('close',(code,signal) => { rec.exitCode = code; rec.signal = signal; if (activeRecording === rec) activeRecording = null; if (code !== 0) console.error('FFmpeg kayıt hatası:',rec.stderr); });
  rec.maxTimer = setTimeout(() => { if (activeRecording === rec) finishRecording('maximum-duration').catch(console.error); },MAX_RECORD_MS);
  res.json({ ok:true,recording:true,stationName:rec.stationName,maxDurationMinutes:30 });
});
app.get('/api/record/status',(req,res) => res.json({ ok:true,recording:!!activeRecording,stationName:activeRecording?.stationName || null,startedAt:activeRecording?.startedAt || null,elapsedSeconds:activeRecording ? Math.floor((Date.now()-activeRecording.startedAt)/1000) : 0 }));
app.post('/api/record/stop',async(req,res) => {
  if (!activeRecording) return res.status(409).json({ error:'Durdurulacak aktif bir sunucu kaydı yok.' });
  const rec = activeRecording;
  if (rec.maxTimer) clearTimeout(rec.maxTimer);
  try {
    await finishRecording('user-stop');
    if (!fs.existsSync(rec.filePath) || fs.statSync(rec.filePath).size < 1024) {
      try { fs.unlinkSync(rec.filePath); } catch (_) {}
      return res.status(502).json({ error:'Kayıt dosyası oluşmadı. Yayın sunucusu FFmpeg tarafından okunamamış olabilir.', detail:rec.stderr || 'Boş kayıt' });
    }
    res.setHeader('Content-Type','audio/mpeg');
    res.setHeader('Content-Disposition',`attachment; filename="${rec.fileName}"`);
    res.setHeader('Cache-Control','no-store');
    const input = fs.createReadStream(rec.filePath);
    input.on('error',err => { console.error(err); if (!res.headersSent) res.status(500).end('Kayıt okunamadı'); });
    input.pipe(res);
    input.on('close',() => { try { fs.unlinkSync(rec.filePath); } catch (_) {} });
  } catch(err) { console.error('Kayıt durdurma hatası:',err); res.status(500).json({ error:'Kayıt tamamlanamadı.',detail:err.message }); }
});

app.use((req,res) => res.status(404).json({ error:'Adres bulunamadı',path:req.path }));
app.listen(PORT,() => {
  console.log('Online Radyo sunucusu başlatıldı. Sürüm: 3.3 Port:',PORT);
  console.log('Yayın izinli sunucular:',allowedHosts);
  console.log('Kayıt izinli sunucular:',recordAllowedHosts);
  console.log('Kayıt klasörü:',dataDir);
});
