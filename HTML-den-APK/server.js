const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const JOB_DIR = path.join(DATA_DIR, 'jobs');
for (const dir of [DATA_DIR, UPLOAD_DIR, JOB_DIR]) fs.mkdirSync(dir, { recursive: true });
// Render Free has ephemeral storage; discard stale temporary files to limit disk growth.
for (const dir of [UPLOAD_DIR, JOB_DIR]) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    try { if (Date.now() - fs.statSync(file).mtimeMs > 24 * 60 * 60 * 1000) fs.rmSync(file, { recursive: true, force: true }); } catch {}
  }
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'], scriptSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"]
}}}));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(9).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = file.fieldname === 'project' ? ['.html', '.htm', '.zip'] : ['.png', '.jpg', '.jpeg', '.webp'];
    if (!allowed.includes(ext)) return cb(new Error(file.fieldname === 'project' ? 'Yalnızca .html, .htm veya .zip dosyaları yüklenebilir.' : 'Logo PNG, JPG veya WEBP olmalıdır.'));
    cb(null, true);
  }
});

function cleanText(value, max) { return String(value || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, max); }
function writeJob(job) { fs.writeFileSync(path.join(JOB_DIR, `${job.id}.json`), JSON.stringify(job, null, 2)); }
function readJob(id) {
  if (!/^[a-zA-Z0-9_-]{8,32}$/.test(id)) return null;
  const file = path.join(JOB_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function githubConfigReady() {
  return Boolean(process.env.GH_TOKEN && process.env.GH_OWNER && process.env.GH_REPO && process.env.BUILD_WEBHOOK_SECRET && process.env.SOURCE_ACCESS_SECRET);
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
async function dispatchBuild(job) {
  const owner = process.env.GH_OWNER; const repo = process.env.GH_REPO;
  const workflow = process.env.GH_WORKFLOW || 'build-android.yml';
  const branch = process.env.GH_BRANCH || 'main';
  const baseUrl = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('PUBLIC_BASE_URL veya RENDER_EXTERNAL_URL tanımlı değil.');
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: branch, inputs: {
      job_id: job.id,
      source_url: `${baseUrl}/api/build-source/${job.id}`,
      app_name: job.appName,
      package_name: job.packageName,
      version: job.version,
      has_icon: job.iconFile ? 'true' : 'false'
    } })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub Actions tetiklenemedi (${response.status}): ${detail.slice(0, 300)}`);
  }
}

app.post('/api/projects', upload.fields([{ name: 'project', maxCount: 1 }, { name: 'icon', maxCount: 1 }]), async (req, res) => {
  const projectFile = req.files?.project?.[0];
  const iconFile = req.files?.icon?.[0];
  if (!projectFile) return res.status(400).json({ error: 'Lütfen HTML veya ZIP dosyası seçin.' });
  const appName = cleanText(req.body.appName, 40);
  const packageName = cleanText(req.body.packageName, 120).toLowerCase();
  const version = cleanText(req.body.version || '1.0.0', 20);
  const removeFiles = () => { for (const f of [projectFile, iconFile].filter(Boolean)) { try { fs.unlinkSync(f.path); } catch {} } };
  if (!appName) { removeFiles(); return res.status(400).json({ error: 'Uygulama adı zorunludur.' }); }
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,5}$/.test(packageName)) { removeFiles(); return res.status(400).json({ error: 'Paket adı geçersiz. Örnek: com.ornek.uygulama' }); }
  if (!/^\d+\.\d+\.\d+$/.test(version)) { removeFiles(); return res.status(400).json({ error: 'Sürüm biçimi 1.0.0 şeklinde olmalıdır.' }); }
  if (!githubConfigReady()) { removeFiles(); return res.status(503).json({ error: 'Derleme servisi henüz yapılandırılmadı. Site yöneticisi GitHub bağlantı ayarlarını tamamlamalı.' }); }
  const id = crypto.randomBytes(10).toString('base64url');
  const job = {
    id, appName, packageName, version,
    originalFile: projectFile.originalname, storedFile: projectFile.filename,
    iconFile: iconFile?.filename || null, fileSize: projectFile.size,
    createdAt: new Date().toISOString(), status: 'queued', progress: 3,
    message: 'Proje alındı. GitHub Actions derleme sırasına gönderiliyor.',
    runId: null, outputs: { artifact: null, downloadUrl: null },
    sourceSecret: process.env.SOURCE_ACCESS_SECRET
  };
  writeJob(job);
  try {
    await dispatchBuild(job);
    job.status = 'queued'; job.progress = 8; job.message = 'Derleme GitHub Actions kuyruğuna gönderildi.'; writeJob(job);
    res.status(202).json({ id, status: job.status, message: job.message });
  } catch (err) {
    job.status = 'failed'; job.progress = 0; job.message = err.message; writeJob(job); removeFiles();
    res.status(502).json({ error: `Derleme başlatılamadı: ${err.message}` });
  }
});

// GitHub Actions retrieves the upload using a shared secret stored only in server/repository secrets.
app.get('/api/build-source/:id', (req, res) => {
  const job = readJob(req.params.id);
  if (!job || !safeEqual(req.get('authorization')?.replace(/^Bearer\s+/i, ''), job.sourceSecret)) return res.sendStatus(404);
  const file = path.join(UPLOAD_DIR, path.basename(job.storedFile));
  if (!fs.existsSync(file)) return res.status(410).json({ error: 'Yüklenen proje artık mevcut değil.' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="project-upload${path.extname(job.originalFile).toLowerCase()}"`);
  fs.createReadStream(file).pipe(res);
});
app.get('/api/build-icon/:id', (req, res) => {
  const job = readJob(req.params.id);
  if (!job || !job.iconFile || !safeEqual(req.get('authorization')?.replace(/^Bearer\s+/i, ''), job.sourceSecret)) return res.sendStatus(404);
  const file = path.join(UPLOAD_DIR, path.basename(job.iconFile));
  if (!fs.existsSync(file)) return res.sendStatus(404);
  res.sendFile(file);
});

app.post('/api/build-callback', (req, res) => {
  if (!safeEqual(req.get('authorization')?.replace(/^Bearer\s+/i, ''), process.env.BUILD_WEBHOOK_SECRET)) return res.sendStatus(401);
  const { job_id, status, progress, message, run_id } = req.body || {};
  const job = readJob(job_id);
  if (!job) return res.sendStatus(404);
  const allowed = ['queued', 'building', 'success', 'failed'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Geçersiz durum.' });
  job.status = status;
  job.progress = Math.max(0, Math.min(100, Number(progress) || 0));
  job.message = cleanText(message, 300) || 'Derleme durumu güncellendi.';
  if (run_id) job.runId = String(run_id);
  if (status === 'success') {
    job.progress = 100;
    job.outputs = { artifact: `html-den-apk-${job.id}`, downloadUrl: `/api/jobs/${job.id}/download` };
  }
  writeJob(job);
  res.json({ ok: true });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = readJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'İş bulunamadı.' });
  res.json({ id: job.id, appName: job.appName, status: job.status, progress: job.progress, message: job.message, outputs: job.outputs, createdAt: job.createdAt });
});

app.get('/api/jobs/:id/download', async (req, res) => {
  const job = readJob(req.params.id);
  if (!job || job.status !== 'success' || !job.runId) return res.status(409).json({ error: 'Derleme henüz tamamlanmadı.' });
  try {
    const api = `https://api.github.com/repos/${encodeURIComponent(process.env.GH_OWNER)}/${encodeURIComponent(process.env.GH_REPO)}/actions/runs/${encodeURIComponent(job.runId)}/artifacts`;
    const list = await fetch(api, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!list.ok) throw new Error(`GitHub artifact listesi alınamadı: ${list.status}`);
    const data = await list.json();
    const artifact = (data.artifacts || []).find(a => a.name === `html-den-apk-${job.id}` && !a.expired);
    if (!artifact) return res.status(404).json({ error: 'Derleme çıktısı bulunamadı veya saklama süresi doldu.' });
    const download = await fetch(`https://api.github.com/repos/${encodeURIComponent(process.env.GH_OWNER)}/${encodeURIComponent(process.env.GH_REPO)}/actions/artifacts/${artifact.id}/zip`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'follow' });
    if (!download.ok) throw new Error(`Artifact indirilemedi: ${download.status}`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="html-den-apk-${job.id}.zip"`);
    const { Readable } = require('stream');
    Readable.fromWeb(download.body).pipe(res);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'HTML-den-APK', buildEngine: githubConfigReady() ? 'configured' : 'not-configured' }));
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Dosya boyutu en fazla 20 MB olabilir.' : 'Dosya yükleme sınırı aşıldı.' });
  res.status(400).json({ error: err.message || 'Beklenmeyen bir hata oluştu.' });
});

app.listen(PORT, () => console.log(`HTML-den-APK çalışıyor: ${PORT}`));
