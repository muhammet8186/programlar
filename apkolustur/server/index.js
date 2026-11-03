const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(os.tmpdir(), 'apk-builder-jobs');
fs.mkdirSync(ROOT, { recursive: true });

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (origin.endsWith('.github.io') || origin === 'http://localhost:3000' || origin === 'https://localhost:3000') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));
const upload = multer({
  dest: path.join(ROOT, 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }
});

function safeSlug(s) {
  return String(s || 'MyApp').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'MyApp';
}
function safePackage(s) {
  const v = String(s || 'com.example.myapp').toLowerCase();
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/.test(v)) {
    throw new Error('Paket kimliği en az üç bölüm olmalı. Örnek: com.ornek.uygulamam');
  }
  return v;
}
function run(cmd, args, cwd, log) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: process.env });
    p.stdout.on('data', d => log(String(d)));
    p.stderr.on('data', d => log(String(d)));
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} başarısız (kod ${code})`)));
  });
}
function safeUnzip(zipPath, dest, log) {
  return run('unzip', ['-o', zipPath, '-d', dest], dest, log);
}

app.post('/api/build', upload.single('project'), async (req, res) => {
  const jobId = crypto.randomBytes(8).toString('hex');
  const jobDir = path.join(ROOT, jobId);
  const logLines = [];
  const log = s => { logLines.push(s); console.log(`[${jobId}] ${s.trim()}`); };
  const title = String(req.body.appName || 'HTML Uygulamam').slice(0, 50);
  let appId;
  try { appId = safePackage(req.body.appId); }
  catch (e) { if (req.file) fs.rmSync(req.file.path, { force: true }); return res.status(400).json({ error: e.message }); }
  if (!req.file) return res.status(400).json({ error: 'HTML veya ZIP dosyası seçmelisin.' });
  fs.mkdirSync(jobDir, { recursive: true });
  const sourceDir = path.join(jobDir, 'source');
  fs.mkdirSync(sourceDir, { recursive: true });
  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === '.html' || ext === '.htm') {
      fs.copyFileSync(req.file.path, path.join(sourceDir, 'index.html'));
    } else if (ext === '.zip') {
      await safeUnzip(req.file.path, sourceDir, log);
      // ZIP tek bir klasör içeriyorsa dosyaları bir seviye yukarı al.
      const entries = fs.readdirSync(sourceDir);
      if (entries.length === 1 && fs.statSync(path.join(sourceDir, entries[0])).isDirectory()) {
        const nested = path.join(sourceDir, entries[0]);
        for (const item of fs.readdirSync(nested)) fs.renameSync(path.join(nested, item), path.join(sourceDir, item));
        fs.rmSync(nested, { recursive: true, force: true });
      }
      if (!fs.existsSync(path.join(sourceDir, 'index.html'))) {
        throw new Error('ZIP içinde kök dizinde index.html bulunamadı.');
      }
    } else {
      throw new Error('Yalnızca .html, .htm veya .zip dosyası yükleyebilirsin.');
    }
    fs.rmSync(req.file.path, { force: true });

    const projectDir = path.join(jobDir, 'capacitor-app');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.cpSync(sourceDir, path.join(projectDir, 'www'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: safeSlug(title),
      version: '1.0.0',
      private: true,
      scripts: {},
      dependencies: { '@capacitor/core': '^6.2.0' },
      devDependencies: { '@capacitor/cli': '^6.2.0', '@capacitor/android': '^6.2.0' }
    }, null, 2));
    fs.writeFileSync(path.join(projectDir, 'capacitor.config.json'), JSON.stringify({
      appId, appName: title, webDir: 'www'
    }, null, 2));

    log('Node bağımlılıkları yükleniyor…');
    await run('npm', ['install', '--no-audit', '--no-fund'], projectDir, log);
    log('Android projesi hazırlanıyor…');
    await run('npx', ['cap', 'add', 'android'], projectDir, log);
    await run('npx', ['cap', 'sync', 'android'], projectDir, log);
    log('APK derleniyor. İlk derleme birkaç dakika sürebilir…');
    const androidDir = path.join(projectDir, 'android');
    const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    await run(gradle, ['assembleDebug'], androidDir, log);

    const apkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    if (!fs.existsSync(apkPath)) throw new Error('Derleme bitti ancak APK dosyası bulunamadı.');
    const downloadName = `${safeSlug(title)}-debug.apk`;
    res.download(apkPath, downloadName, () => fs.rmSync(jobDir, { recursive: true, force: true }));
  } catch (err) {
    log(`HATA: ${err.message}`);
    fs.rmSync(jobDir, { recursive: true, force: true });
    res.status(500).json({
      error: 'APK oluşturulamadı.',
      details: err.message,
      log: logLines.slice(-30).join('')
    });
  }
});

app.get('/api/health', (_, res) => res.json({ ok: true, service: 'Kendi APK Oluşturucumuz', version: '0.2.0', java: process.env.JAVA_HOME || null, androidSdk: process.env.ANDROID_HOME || null }));
app.listen(PORT, '0.0.0.0', () => console.log(`APK oluşturucu çalışıyor: http://0.0.0.0:${PORT}`));
