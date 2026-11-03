
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// --------------------------------------------------
// AYARLAR
// --------------------------------------------------

const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERSION = '3.5.8';

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

const MAX_REDIRECTS = 5;
const MAX_RECORD_MS = 30 * 60 * 1000;
const RECORD_START_TIMEOUT = 30000;
const STOP_TIMEOUT = 8000;

const allowedHosts = (
    process.env.STREAM_PROXY_ALLOWED_HOSTS ||
    'sslyayin.netyayin.net'
)
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);

const recordAllowedHosts = (
    process.env.RECORD_ALLOWED_HOSTS ||
    '*'
)
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);

const dataDir =
    process.env.RECORDINGS_DIR ||
    (process.env.RENDER_DISK_PATH
        ? path.join(
            process.env.RENDER_DISK_PATH,
            'recordings'
        )
        : path.join(__dirname, 'recordings'));

try {
    fs.mkdirSync(dataDir, { recursive: true });
} catch (err) {
    console.error(
        'Kayıt klasörü oluşturulamadı:',
        err.message
    );
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// --------------------------------------------------
// PWA İKONLARI
// --------------------------------------------------

app.use('/icons', express.static(path.join(__dirname, 'icons'), {
    fallthrough: false,
    maxAge: '7d'
}));

// --------------------------------------------------
// ANA SAYFA
// --------------------------------------------------

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');

    if (!fs.existsSync(indexPath)) {
        return res.status(404).send('index.html bulunamadı.');
    }

    res.sendFile(indexPath);
});

// --------------------------------------------------
// M3U / PLS LİSTE YÜKLEME PROXY'Sİ
// --------------------------------------------------

app.get('/api/playlist', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();

    let playlistUrl;

    try {
        playlistUrl = new URL(rawUrl);

        if (
            playlistUrl.protocol !== 'http:' &&
            playlistUrl.protocol !== 'https:'
        ) {
            return res.status(400).json({
                error: 'Yalnızca HTTP veya HTTPS adresleri desteklenir.'
            });
        }
    } catch (err) {
        return res.status(400).json({
            error: 'Geçerli bir M3U URL adresi girilmedi.'
        });
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, 12000);

    try {
        const response = await fetch(playlistUrl.href, {
            method: 'GET',
            redirect: 'follow',
            cache: 'no-store',
            signal: controller.signal,

            headers: {
                'User-Agent': 'Radyo-Playlist-Loader/1.0',
                'Accept': 'audio/x-mpegurl, application/vnd.apple.mpegurl, audio/mpegurl, text/plain, */*'
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({
                error: `Liste sunucusu HTTP ${response.status} yanıtı verdi.`
            });
        }

        const finalUrl = new URL(
            response.url || playlistUrl.href
        );

        if (
            finalUrl.protocol !== 'http:' &&
            finalUrl.protocol !== 'https:'
        ) {
            return res.status(400).json({
                error: 'Güvenli olmayan yönlendirme tespit edildi.'
            });
        }

        const declaredLength = Number(
            response.headers.get('content-length') || 0
        );

        const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024;

        if (declaredLength > MAX_PLAYLIST_BYTES) {
            return res.status(413).json({
                error: 'M3U listesi 8 MB sınırını aşıyor.'
            });
        }

        const body = await response.arrayBuffer();

        if (body.byteLength > MAX_PLAYLIST_BYTES) {
            return res.status(413).json({
                error: 'M3U listesi 8 MB sınırını aşıyor.'
            });
        }

        const playlistText = Buffer.from(body).toString('utf8');

        if (!playlistText.trim()) {
            return res.status(422).json({
                error: 'M3U listesi boş.'
            });
        }

        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.set('Cache-Control', 'no-store');
        res.set('X-Playlist-Source', finalUrl.hostname);

        return res.send(playlistText);

    } catch (error) {
        const message = error.name === 'AbortError'
            ? 'M3U bağlantısı 12 saniyede yanıt vermedi.'
            : 'M3U listesi sunucudan alınamadı.';

        return res.status(502).json({
            error: message
        });

    } finally {
        clearTimeout(timeout);
    }
});

// --------------------------------------------------
// RADYO YAYIN PROXY'Sİ
// --------------------------------------------------

app.get('/stream', (req, res) => {
    const rawUrl = String(req.query.url || '').trim();

    if (!rawUrl) {
        return res.status(400).send('Yayın adresi belirtilmedi.');
    }

    let streamUrl;

    try {
        streamUrl = new URL(rawUrl);
    } catch (err) {
        return res.status(400).send('Geçersiz yayın adresi.');
    }

    if (
        streamUrl.protocol !== 'http:' &&
        streamUrl.protocol !== 'https:'
    ) {
        return res.status(400).send('Desteklenmeyen yayın protokolü.');
    }

    const hostname = streamUrl.hostname.toLowerCase();

    const isAllowed = allowedHosts.some(host => {
        return hostname === host ||
            hostname.endsWith('.' + host);
    });

    if (!isAllowed && !allowedHosts.includes('*')) {
        return res.status(403).send('Bu yayın adresine izin verilmiyor.');
    }

    const transport = streamUrl.protocol === 'https:'
        ? https
        : http;

    const proxyRequest = transport.get(streamUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Icy-MetaData': '1'
        }
    }, proxyResponse => {

        if (proxyResponse.statusCode >= 300 &&
            proxyResponse.statusCode < 400 &&
            proxyResponse.headers.location) {

            proxyResponse.resume();

            if (MAX_REDIRECTS <= 0) {
                return res.status(502).send('Yönlendirme sınırı aşıldı.');
            }

            return res.redirect(
                302,
                proxyResponse.headers.location
            );
        }

        res.status(proxyResponse.statusCode || 200);

        const contentType =
            proxyResponse.headers['content-type'] ||
            'audio/mpeg';

        res.setHeader('Content-Type', contentType);

        if (proxyResponse.headers['icy-name']) {
            res.setHeader(
                'icy-name',
                proxyResponse.headers['icy-name']
            );
        }

        proxyResponse.pipe(res);

        proxyResponse.on('error', error => {
            console.error('Yayın proxy hatası:', error.message);

            if (!res.headersSent) {
                res.status(502).end('Yayın alınamadı.');
            } else {
                res.end();
            }
        });
    });

    proxyRequest.setTimeout(15000, () => {
        proxyRequest.destroy(
            new Error('Yayın bağlantısı zaman aşımına uğradı.')
        );
    });

    proxyRequest.on('error', error => {
        console.error('Stream bağlantı hatası:', error.message);

        if (!res.headersSent) {
            res.status(502).send('Radyo yayınına bağlanılamadı.');
        }
    });

    req.on('close', () => {
        proxyRequest.destroy();
    });
});

// --------------------------------------------------
// KAYIT SİSTEMİ
// --------------------------------------------------

let recordingProcess = null;
let currentRecording = null;
let recordingStartTime = null;
let recordingTimer = null;

function getRecordingStatus() {
    return {
        recording: Boolean(recordingProcess),

        lastRecording: currentRecording
            ? {
                filename: currentRecording.filename,
                filePath: currentRecording.filePath,
                startedAt: recordingStartTime,
                finished: !recordingProcess,
                finishReason: currentRecording.finishReason || null
            }
            : null
    };
}

// --------------------------------------------------
// KAYIT BAŞLAT
// --------------------------------------------------

app.post('/api/record/start', (req, res) => {
    if (recordingProcess) {
        return res.status(409).json({
            error: 'Zaten devam eden bir kayıt var.'
        });
    }

    const streamUrl = String(req.body.url || '').trim();

    if (!streamUrl) {
        return res.status(400).json({
            error: 'Kayıt için yayın adresi gerekli.'
        });
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(streamUrl);
    } catch (err) {
        return res.status(400).json({
            error: 'Geçersiz yayın adresi.'
        });
    }

    if (
        parsedUrl.protocol !== 'http:' &&
        parsedUrl.protocol !== 'https:'
    ) {
        return res.status(400).json({
            error: 'Desteklenmeyen yayın protokolü.'
        });
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    const isAllowed = recordAllowedHosts.some(host => {
        return host === '*' ||
            hostname === host ||
            hostname.endsWith('.' + host);
    });

    if (!isAllowed) {
        return res.status(403).json({
            error: 'Bu yayın adresinden kayıt yapılmasına izin verilmiyor.'
        });
    }

    const filename =
        'radyo-kayit-' +
        new Date().toISOString().replace(/[:.]/g, '-') +
        '.mp3';

    const filePath = path.join(dataDir, filename);

    const args = [
        '-y',
        '-i', streamUrl,
        '-vn',
        '-codec:a', 'libmp3lame',
        '-b:a', '192k',
        '-ar', '44100,
        '-ac', '2',
        filePath
    ];

    // FFmpeg parametreleri
    args[args.indexOf('-ar') + 1] = '44100';

    const ffmpeg = spawn(ffmpegPath, args);

    recordingProcess = ffmpeg;

    currentRecording = {
        filename,
        filePath,
        finishReason: null
    };

    recordingStartTime = new Date().toISOString();

    let stderrOutput = '';

    ffmpeg.stderr.on('data', data => {
        stderrOutput += data.toString();

        if (stderrOutput.length > 5000) {
            stderrOutput = stderrOutput.slice(-5000);
        }
    });

    ffmpeg.on('error', error => {
        console.error('FFmpeg başlatma hatası:', error.message);

        recordingProcess = null;

        if (currentRecording) {
            currentRecording.finishReason = 'error';
        }

        clearTimeout(recordingTimer);
    });

    ffmpeg.on('close', code => {
        console.log('FFmpeg kayıt işlemi sona erdi. Kod:', code);

        recordingProcess = null;

        if (currentRecording) {
            currentRecording.finishReason =
                code === 0 ? 'completed' : 'error';
        }

        clearTimeout(recordingTimer);
    });

    recordingTimer = setTimeout(() => {
        if (recordingProcess) {
            console.log('Maksimum kayıt süresi doldu.');

            currentRecording.finishReason = 'max-duration';

            recordingProcess.kill('SIGTERM');
        }
    }, MAX_RECORD_MS);

    res.json({
        success: true,
        message: 'Radyo kaydı başlatıldı.',
        filename
    });
});

// --------------------------------------------------
// KAYIT DURDUR
// --------------------------------------------------

app.post('/api/record/stop', (req, res) => {
    if (!recordingProcess) {
        return res.status(400).json({
            error: 'Devam eden kayıt bulunamadı.'
        });
    }

    const processToStop = recordingProcess;

    if (currentRecording) {
        currentRecording.finishReason = 'user-stop';
    }

    recordingProcess = null;

    clearTimeout(recordingTimer);

    processToStop.kill('SIGTERM');

    res.json({
        success: true,
        message: 'Kayıt durduruluyor.'
    });
});

// --------------------------------------------------
// KAYIT DURUMU
// --------------------------------------------------

app.get('/api/record/status', (req, res) => {
    res.json(getRecordingStatus());
});

// --------------------------------------------------
// KAYIT DOSYALARINI LİSTELE
// --------------------------------------------------

app.get('/api/recordings', (req, res) => {
    try {
        const files = fs.readdirSync(dataDir);

        const recordings = files
            .filter(file => file.toLowerCase().endsWith('.mp3'))
            .map(filename => {
                const filePath = path.join(dataDir, filename);

                const stats = fs.statSync(filePath);

                return {
                    filename,
                    size: stats.size,
                    createdAt: stats.birthtime
                };
            })
            .sort((a, b) => b.createdAt - a.createdAt);

        res.json(recordings);

    } catch (error) {
        console.error('Kayıt listesi hatası:', error.message);

        res.status(500).json({
            error: 'Kayıt dosyaları listelenemedi.'
        });
    }
});

// --------------------------------------------------
// MP3 İNDİR
// --------------------------------------------------

app.get('/api/recordings/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);

    if (!filename.toLowerCase().endsWith('.mp3')) {
        return res.status(400).send('Geçersiz dosya türü.');
    }

    const filePath = path.join(dataDir, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Kayıt dosyası bulunamadı.');
    }

    res.download(filePath, filename, error => {
        if (error) {
            console.error('İndirme hatası:', error.message);
        }
    });
});

// --------------------------------------------------
// KAYIT SİL
// --------------------------------------------------

app.delete('/api/recordings/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);

    if (!filename.toLowerCase().endsWith('.mp3')) {
        return res.status(400).json({
            error: 'Geçersiz dosya türü.'
        });
    }

    const filePath = path.join(dataDir, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({
            error: 'Kayıt dosyası bulunamadı.'
        });
    }

    try {
        fs.unlinkSync(filePath);

        res.json({
            success: true,
            message: 'Kayıt silindi.'
        });

    } catch (error) {
        console.error('Dosya silme hatası:', error.message);

        res.status(500).json({
            error: 'Kayıt dosyası silinemedi.'
        });
    }
});

// --------------------------------------------------
// SAĞLIK KONTROLÜ
// --------------------------------------------------

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        version: VERSION,
        uptime: process.uptime()
    });
});

// --------------------------------------------------
// SUNUCUYU BAŞLAT
// --------------------------------------------------

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Radyo kayıt sunucusu ${PORT} portunda çalışıyor.`);
    console.log(`Sürüm: ${VERSION}`);
    console.log(`Kayıt klasörü: ${dataDir}`);
});

// --------------------------------------------------
// KAPANMA
// --------------------------------------------------

process.on('SIGTERM', () => {
    console.log('SIGTERM alındı, sunucu kapatılıyor.');

    if (recordingProcess) {
        recordingProcess.kill('SIGTERM');
    }

    server.close(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT alındı, sunucu kapatılıyor.');

    if (recordingProcess) {
        recordingProcess.kill('SIGTERM');
    }

    server.close(() => {
        process.exit(0);
    });
});
