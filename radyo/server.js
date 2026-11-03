
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

// GET harici M3U/PLS listesi (tarayıcı CORS kısıtlamasını sunucu tarafında aşar)
app.get('/api/playlist', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    let playlistUrl;

    try {
        playlistUrl = new URL(rawUrl);
        if (!['http:', 'https:'].includes(playlistUrl.protocol)) {
            return res.status(400).json({ error: 'Yalnızca HTTP veya HTTPS liste adresleri desteklenir.' });
        }
    } catch (_) {
        return res.status(400).json({ error: 'Geçerli bir liste URL’si gönderilmedi.' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

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
            return res.status(response.status).json({ error: `Liste sunucusu HTTP ${response.status} yanıtı verdi.` });
        }

        const finalUrl = new URL(response.url || playlistUrl.href);
        if (!['http:', 'https:'].includes(finalUrl.protocol)) {
            return res.status(400).json({ error: 'Liste yönlendirmesi güvenli olmayan bir protokole ulaştı.' });
        }

        const declaredLength = Number(response.headers.get('content-length') || 0);
        const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024;
        if (declaredLength > MAX_PLAYLIST_BYTES) {
            return res.status(413).json({ error: 'Kanal listesi 8 MB sınırını aşıyor.' });
        }

        const body = await response.arrayBuffer();
        if (body.byteLength > MAX_PLAYLIST_BYTES) {
            return res.status(413).json({ error: 'Kanal listesi 8 MB sınırını aşıyor.' });
        }

        const playlistText = Buffer.from(body).toString('utf8');
        if (!playlistText.trim()) {
            return res.status(422).json({ error: 'Liste içeriği boş.' });
        }

        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.set('Cache-Control', 'no-store');
        res.set('X-Playlist-Source', finalUrl.hostname);
        return res.send(playlistText);
    } catch (error) {
        const message = error.name === 'AbortError'
            ? 'Kanal listesi bağlantısı 12 saniyede yanıt vermedi.'
            : 'Kanal listesi sunucudan alınamadı.';
        return res.status(502).json({ error: message });
    } finally {
        clearTimeout(timeout);
    }
});

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
      