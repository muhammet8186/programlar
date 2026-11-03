
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

// PWA ikonlarını Render üzerinde sun.
app.use('/icons', express.static(path.join(__dirname, 'icons'), {
    fallthrough: false,
    maxAge: '7d'
}));

// --------------------------------------------------
// ANA SAYFA VE PWA
// --------------------------------------------------

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');

    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }

    res.status(404).send(`
        <!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport"
                  content="width=device-width, initial-scale=1">
            <title>Online Radyo</title>
        </head>
        <body>
            <h2>Online Radyo</h2>
            <p>index.html dosyası bulunamadı.</p>
        </body>
        </html>
    `);
});

app.get('/manifest.json', (req, res) => {
    const manifestPath = path.join(
        __dirname,
        'manifest.json'
    );

    if (!fs.existsSync(manifestPath)) {
        return res.status(404).json({
            error: 'manifest.json bulunamadı.'
        });
    }

    res.sendFile(manifestPath);
});

app.get('/service-worker.js', (req, res) => {
    const swPath = path.join(
        __dirname,
        'service-worker.js'
    );

    if (!fs.existsSync(swPath)) {
        return res.status(404).send(
            'service-worker.js bulunamadı.'
        );
    }

    res.setHeader(
        'Content-Type',
        'application/javascript'
    );

    res.setHeader(
        'Service-Worker-Allowed',
        '/'
    );

    res.sendFile(swPath);
});

// --------------------------------------------------
// SAĞLIK KONTROLÜ
// --------------------------------------------------

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        version: VERSION,
        ffmpeg: ffmpegPath,
        recording: Boolean(activeRecording),
        time: new Date().toISOString()
    });
});

// --------------------------------------------------
// API BİLGİSİ
// --------------------------------------------------

app.get('/api/info', (req, res) => {
    res.json({
        name: 'Online Radyo',
        version: VERSION,
        status: 'active',
        recording: Boolean(activeRecording)
    });
});

// --------------------------------------------------
// YARDIMCI FONKSİYONLAR
// --------------------------------------------------

function isValidUrl(value) {
    try {
        const parsed = new URL(value);

        return (
            parsed.protocol === 'http:' ||
            parsed.protocol === 'https:'
        );
    } catch (_) {
        return false;
    }
}

function isHostAllowed(hostname, list) {
    const host = String(hostname || '')
        .toLowerCase();

    if (list.includes('*')) {
        return true;
    }

    return list.some(item =>
        host === item ||
        host.endsWith('.' + item)
    );
}

function getRequestModule(protocol) {
    return protocol === 'https:'
        ? https
        : http;
}

function getSafeStreamUrl(value, list) {
    if (!isValidUrl(value)) {
        throw new Error(
            'Geçersiz yayın adresi.'
        );
    }

    const parsed = new URL(value);

    if (
        !isHostAllowed(
            parsed.hostname,
            list
        )
    ) {
        throw new Error(
            'Bu yayın sunucusuna erişim izni verilmemiş: ' +
            parsed.hostname
        );
    }

    return parsed;
}

// --------------------------------------------------
// RADYO YAYINI PROXY
// --------------------------------------------------

function proxyStream(
    targetUrl,
    res,
    redirectCount = 0
) {
    let parsed;

    try {
        parsed = getSafeStreamUrl(
            targetUrl,
            allowedHosts
        );
    } catch (err) {
        return res.status(403).json({
            error: err.message
        });
    }

    if (redirectCount > MAX_REDIRECTS) {
        return res.status(502).send(
            'Yayın çok fazla yönlendirme yaptı.'
        );
    }

    const requestModule = getRequestModule(
        parsed.protocol
    );

    const proxyReq = requestModule.get(
        parsed,
        {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Icy-MetaData': '0'
            },
            timeout: 20000
        },
        proxyRes => {
            const statusCode =
                proxyRes.statusCode || 200;

            // Yönlendirme
            if (
                statusCode >= 300 &&
                statusCode < 400 &&
                proxyRes.headers.location
            ) {
                proxyRes.resume();

                let redirectUrl;

                try {
                    redirectUrl = new URL(
                        proxyRes.headers.location,
                        parsed
                    ).toString();
                } catch (_) {
                    return res.status(502).send(
                        'Geçersiz yayın yönlendirmesi.'
                    );
                }

                return proxyStream(
                    redirectUrl,
                    res,
                    redirectCount + 1
                );
            }

            // Yayın sunucusu hatası
            if (statusCode >= 400) {
                proxyRes.resume();

                if (!res.headersSent) {
                    res.status(statusCode).send(
                        'Radyo yayın sunucusu hata verdi.'
                    );
                }

                return;
            }

            res.status(200);

            res.setHeader(
                'Content-Type',
                proxyRes.headers['content-type'] ||
                'audio/mpeg'
            );

            res.setHeader(
                'Cache-Control',
                'no-cache, no-store, must-revalidate'
            );

            res.setHeader(
                'Connection',
                'keep-alive'
            );

            proxyRes.pipe(res);

            proxyRes.on('error', err => {
                console.error(
                    'Yayın aktarım hatası:',
                    err.message
                );

                if (!res.destroyed) {
                    res.destroy(err);
                }
            });
        }
    );

    proxyReq.on('error', err => {
        console.error(
            'Radyo proxy hatası:',
            err.message
        );

        if (!res.headersSent) {
            res.status(502).send(
                'Radyo yayınına bağlanılamadı.'
            );
        }
    });

    proxyReq.on('timeout', () => {
        proxyReq.destroy(
            new Error(
                'Radyo bağlantısı zaman aşımına uğradı.'
            )
        );
    });

    res.on('close', () => {
        proxyReq.destroy();
    });
}

// GET yayın
app.get('/stream', (req, res) => {
    const streamUrl = req.query.url;

    if (!streamUrl) {
        return res.status(400).json({
            error: 'Yayın adresi belirtilmedi.'
        });
    }

    proxyStream(streamUrl, res);
});

// HEAD yayın
app.head('/stream', (req, res) => {
    const streamUrl = req.query.url;

    if (!streamUrl) {
        return res.status(400).end();
    }

    let parsed;

    try {
        parsed = getSafeStreamUrl(
            streamUrl,
            allowedHosts
        );
    } catch (_) {
        return res.status(403).end();
    }

    const requestModule = getRequestModule(
        parsed.protocol
    );

    const proxyReq = requestModule.request(
        parsed,
        {
            method: 'HEAD',
            headers: {
                'User-Agent': 'Mozilla/5.0'
            },
            timeout: 15000
        },
        proxyRes => {
            res.status(
                proxyRes.statusCode || 200
            );

            res.setHeader(
                'Content-Type',
                proxyRes.headers['content-type'] ||
                'audio/mpeg'
            );

            proxyRes.resume();
            res.end();
        }
    );

    proxyReq.on('error', () => {
        if (!res.headersSent) {
            res.status(502).end();
        }
    });

    proxyReq.on('timeout', () => {
        proxyReq.destroy();
    });

    proxyReq.end();
});

// --------------------------------------------------
// KAYIT SİSTEMİ
// --------------------------------------------------

let activeRecording = null;
let lastRecording = null;

// Güvenli dosya adı oluştur
function createFileName(stationName) {
    const safeName = String(
        stationName || 'Radyo'
    )
        .replace(
            /[<>:"/\\|?*\x00-\x1F]/g,
            '_'
        )
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100) || 'Radyo';

    const now = new Date();

    const date = [
        now.getFullYear(),
        String(
            now.getMonth() + 1
        ).padStart(2, '0'),
        String(
            now.getDate()
        ).padStart(2, '0')
    ].join('-');

    const time = [
        String(
            now.getHours()
        ).padStart(2, '0'),
        String(
            now.getMinutes()
        ).padStart(2, '0'),
        String(
            now.getSeconds()
        ).padStart(2, '0')
    ].join('-');

    return `${safeName}_${date}_${time}.mp3`;
}

// --------------------------------------------------
// KAYIT TAMAMLAMA
// --------------------------------------------------

function finishRecording(reason = 'user-stop') {
    const rec = activeRecording;

    if (!rec) {
        return Promise.resolve(
            lastRecording || null
        );
    }

    // Daha önce durdurma başladıysa aynı işlemi bekle.
    if (rec.finishPromise) {
        return rec.finishPromise;
    }

    rec.finishing = true;
    rec.finishReason = reason;

    rec.finishPromise = new Promise(resolve => {
        rec.resolveFinish = resolve;
    });

    if (rec.maxTimer) {
        clearTimeout(rec.maxTimer);
        rec.maxTimer = null;
    }

    if (rec.startTimer) {
        clearTimeout(rec.startTimer);
        rec.startTimer = null;
    }

    const finalize = () => {
        // close olayı rec.finished'i daha önce ayarlamış olsa da
        // finishPromise mutlaka çözümlensin.
        rec.finished = true;

        if (activeRecording === rec) {
            activeRecording = null;
        }

        lastRecording = rec;

        if (rec.resolveFinish) {
            rec.resolveFinish(rec);
            rec.resolveFinish = null;
        }
    };

    if (!rec.ffmpeg || rec.ffmpegClosed) {
        finalize();
        return rec.finishPromise;
    }

    // FFmpeg zaten kapanıyorsa close olayını bekle.
    try {
        rec.ffmpeg.kill('SIGINT');
    } catch (err) {
        console.error(
            'FFmpeg durdurma hatası:',
            err.message
        );
    }

    // SIGINT yanıt vermezse z