
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
        // FFmpeg close olayı finalize'dan önce rec.finished değerini
        // değiştirebilir. Promise yine de mutlaka çözülmelidir.
        rec.finished = true;

        if (activeRecording === rec) {
            activeRecording = null;
        }

        lastRecording = rec;

        if (rec.resolveFinish) {
            const resolve = rec.resolveFinish;
            rec.resolveFinish = null;
            resolve(rec);
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

    // SIGINT yanıt vermezse zorla kapat.
    rec.stopTimer = setTimeout(() => {
        if (!rec.ffmpegClosed) {
            try {
                rec.ffmpeg.kill('SIGKILL');
            } catch (_) {}
        }
    }, STOP_TIMEOUT);

    return rec.finishPromise;
}

// --------------------------------------------------
// KAYIT BAŞLAT
// --------------------------------------------------

app.post('/api/record/start', (req, res) => {
    const streamUrl = req.body.streamUrl;
    const stationName = req.body.stationName || 'Radyo';

    if (!streamUrl) {
        return res.status(400).json({
            error: 'Yayın adresi belirtilmedi.'
        });
    }

    if (activeRecording) {
        return res.status(409).json({
            error: 'Zaten devam eden bir kayıt var.',
            stationName:
                activeRecording.stationName,
            fileName:
                activeRecording.fileName
        });
    }

    let parsed;

    try {
        parsed = getSafeStreamUrl(
            streamUrl,
            recordAllowedHosts
        );
    } catch (err) {
        return res.status(403).json({
            error: err.message
        });
    }

    const fileName = createFileName(
        stationName
    );

    const filePath = path.join(
        dataDir,
        fileName
    );

    // FFmpeg komut satırı
    const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',

        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-rw_timeout', '15000000',

        '-i', parsed.toString(),

        '-vn',
        '-codec:a', 'libmp3lame',
        '-b:a', '128k',
        '-ar', '44100',
        '-f', 'mp3',

        filePath
    ];

    let ffmpeg;

    try {
        ffmpeg = spawn(
            ffmpegPath,
            ffmpegArgs,
            {
                stdio: [
                    'ignore',
                    'ignore',
                    'pipe'
                ]
            }
        );
    } catch (err) {
        console.error(
            'FFmpeg başlatılamadı:',
            err.message
        );

        return res.status(500).json({
            error: 'FFmpeg başlatılamadı.',
            detail: err.message
        });
    }

    const rec = {
        ffmpeg,

        stationName,
        streamUrl: parsed.toString(),

        fileName,
        filePath,

        startTime: Date.now(),

        stderr: '',
        exitCode: null,
        signal: null,
        error: null,

        finishing: false,
        finished: false,
        ffmpegClosed: false,

        stopRequested: false,

        maxTimer: null,
        startTimer: null,
        stopTimer: null,

        finishPromise: null,
        resolveFinish: null
    };

    activeRecording = rec;

    // FFmpeg hata çıktısı
    ffmpeg.stderr.on('data', chunk => {
        rec.stderr += chunk.toString();

        if (rec.stderr.length > 12000) {
            rec.stderr = rec.stderr.slice(-12000);
        }
    });

    // FFmpeg hata olayı
    ffmpeg.on('error', err => {
        rec.error = err.message;

        console.error(
            'FFmpeg işlem hatası:',
            err.message
        );

        if (rec.startTimer) {
            clearTimeout(rec.startTimer);
            rec.startTimer = null;
        }

        if (rec.maxTimer) {
            clearTimeout(rec.maxTimer);
            rec.maxTimer = null;
        }

        rec.ffmpegClosed = true;

        if (activeRecording === rec) {
            activeRecording = null;
        }

        rec.finished = true;
        rec.finishReason = 'ffmpeg-error';

        if (rec.resolveFinish) {
            rec.resolveFinish(rec);
            rec.resolveFinish = null;
        }
    });

    // FFmpeg kapandığında tek noktadan işle
    ffmpeg.on('close', (code, signal) => {
        rec.ffmpegClosed = true;
        rec.exitCode = code;
        rec.signal = signal;

        console.log(
            'FFmpeg kayıt kapandı:',
            code,
            signal || ''
        );

        if (rec.startTimer) {
            clearTimeout(rec.startTimer);
            rec.startTimer = null;
        }

        if (rec.maxTimer) {
            clearTimeout(rec.maxTimer);
            rec.maxTimer = null;
        }

        if (rec.stopTimer) {
            clearTimeout(rec.stopTimer);
            rec.stopTimer = null;
        }

        rec.finished = true;

        if (activeRecording === rec) {
            activeRecording = null;
        }

        rec.finishReason =
            rec.finishReason || 'ffmpeg-closed';

        lastRecording = rec;

        if (rec.resolveFinish) {
            rec.resolveFinish(rec);
            rec.resolveFinish = null;
        }
    });

    // Maksimum 30 dakika
    rec.maxTimer = setTimeout(() => {
        if (activeRecording === rec) {
            console.log(
                'Maksimum kayıt süresi doldu.'
            );

            finishRecording('max-duration');
        }
    }, MAX_RECORD_MS);

    // Kayıt dosyası oluşmazsa başlatmayı iptal et
    rec.startTimer = setTimeout(() => {
        if (
            activeRecording === rec &&
            !fs.existsSync(filePath)
        ) {
            console.error(
                'Kayıt başlangıç zaman aşımı.'
            );

            rec.error =
                'Kayıt belirtilen sürede başlamadı.';

            finishRecording('start-timeout');
        }
    }, RECORD_START_TIMEOUT);

    res.json({
        success: true,
        message: 'Radyo kaydı başlatıldı.',
        stationName,
        fileName,
        startTime: rec.startTime
    });
});

// --------------------------------------------------
// KAYIT DURUMU
// --------------------------------------------------

app.get('/api/record/status', (req, res) => {
    if (activeRecording) {
        const rec = activeRecording;

        return res.json({
            recording: true,

            stationName: rec.stationName,
            fileName: rec.fileName,

            startTime: rec.startTime,

            duration: Math.floor(
                (Date.now() - rec.startTime) / 1000
            )
        });
    }

    if (lastRecording) {
        return res.json({
            recording: false,

            lastRecording: {
                stationName:
                    lastRecording.stationName,

                fileName:
                    lastRecording.fileName,

                startTime:
                    lastRecording.startTime,

                duration: Math.floor(
                    (
                        Date.now() -
                        lastRecording.startTime
                    ) / 1000
                ),

                finished:
                    lastRecording.finished,

                finishReason:
                    lastRecording.finishReason
            }
        });
    }

    return res.json({
        recording: false,
        lastRecording: null
    });
});

// --------------------------------------------------
// KAYDI DURDUR VE MP3 İNDİR
// --------------------------------------------------

app.post(
    '/api/record/stop',
    async (req, res) => {
        const rec =
            activeRecording || lastRecording;

        if (!rec) {
            return res.status(404).json({
                error:
                    'Durdurulacak veya indirilecek kayıt bulunamadı. ' +
                    'Kayıt başlatma isteği aynı sunucu örneğine ulaşmamış olabilir.'
            });
        }

        try {
            if (activeRecording === rec) {
                rec.stopRequested = true;

                await finishRecording(
                    'user-stop'
                );
            }

            // Dosya oluşmuş mu?
            if (!fs.existsSync(rec.filePath)) {
                const detail =
                    rec.stderr ||
                    rec.error ||
                    (
                        rec.exitCode !== null
                            ? `FFmpeg çıkış kodu: ${rec.exitCode}`
                            : 'Kayıt dosyası oluşmamış.'
                    );

                return res.status(502).json({
                    error:
                        'Kayıt dosyası oluşmadı. Yayın adresi sunucuda okunamamış olabilir.',
                    detail
                });
            }

            const fileStats = fs.statSync(
                rec.filePath
            );

            if (fileStats.size < 1024) {
                const detail =
                    rec.stderr ||
                    rec.error ||
                    'Kayıt dosyası boş veya çok küçük.';

                try {
                    fs.unlinkSync(rec.filePath);
                } catch (_) {}

                if (lastRecording === rec) {
                    lastRecording = null;
                }

                return res.status(502).json({
                    error:
                        'Kayıt dosyası geçerli değil.',
                    detail
                });
            }

            res.setHeader(
                'Content-Type',
                'audio/mpeg'
            );

            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${rec.fileName}"`
            );

            res.setHeader(
                'Cache-Control',
                'no-store'
            );

            const input = fs.createReadStream(
                rec.filePath
            );

            input.on('error', err => {
                console.error(
                    'Kayıt dosyası okuma hatası:',
                    err.message
                );

                if (!res.headersSent) {
                    res.status(500).json({
                        error:
                            'Kayıt dosyası okunamadı.',
                        detail: err.message
                    });
                } else {
                    res.destroy(err);
                }
            });

            res.on('close', () => {
                if (!input.destroyed) {
                    input.destroy();
                }
            });

            input.pipe(res);

        } catch (err) {
            console.error(
                'Kayıt indirme hatası:',
                err.stack || err.message
            );

            if (!res.headersSent) {
                return res.status(500).json({
                    error: 'Kayıt indirilemedi.',
                    detail: err.message
                });
            }

            res.destroy(err);
        }
    }
);

// --------------------------------------------------
// SUNUCUYU BAŞLAT
// --------------------------------------------------

app.listen(PORT, '0.0.0.0', () => {
    console.log(
        `Online Radyo Sunucusu ${VERSION} çalışıyor. Port: ${PORT}`
    );

    console.log(
        'FFmpeg kullanılabilir:',
        ffmpegPath
    );

    console.log(
        'Kayıt klasörü:',
        dataDir
    );

    console.log(
        'İzin verilen kayıt sunucuları:',
        recordAllowedHosts.join(', ')
    );
});
