
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
const VERSION = '3.5.7';

// Docker ortamında sistem FFmpeg kullanılır.
// İstenirse Render Environment üzerinden FFMPEG_PATH tanımlanabilir.
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

const MAX_REDIRECTS = 5;
const MAX_RECORD_MS = 30 * 60 * 1000;
const RECORD_START_TIMEOUT = 30000;

const allowedHosts = (
    process.env.STREAM_PROXY_ALLOWED_HOSTS ||
    'sslyayin.netyayin.net'
)
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);

const recordAllowedHosts = (
    process.env.RECORD_ALLOWED_HOSTS ||
    process.env.STREAM_PROXY_ALLOWED_HOSTS ||
    'sslyayin.netyayin.net'
)
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);

const dataDir =
    process.env.RECORDINGS_DIR ||
    (
        process.env.RENDER_DISK_PATH
            ? path.join(process.env.RENDER_DISK_PATH, 'recordings')
            : path.join(__dirname, 'recordings')
    );

fs.mkdirSync(dataDir, { recursive: true });

let activeRecording = null;
let lastRecording = null;

// --------------------------------------------------
// EXPRESS AYARLARI
// --------------------------------------------------

app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: [
        'Range',
        'Icy-MetaData',
        'Content-Type'
    ],
    exposedHeaders: [
        'Content-Length',
        'Content-Range',
        'Accept-Ranges',
        'Content-Type',
        'Icy-MetaInt',
        'Icy-Name',
        'Icy-Br'
    ]
}));

app.use(express.json({ limit: '32kb' }));

// --------------------------------------------------
// ANA SAYFA
// --------------------------------------------------

app.get('/', (req, res) => {
    res.json({
        ok: true,
        service: 'Online Radyo Sunucusu',
        version: VERSION,
        streamProxy: true,
        serverRecording: true,
        ffmpeg: ffmpegPath
    });
});

// --------------------------------------------------
// SAĞLIK KONTROLÜ
// --------------------------------------------------

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        status: 'running',
        version: VERSION,
        serverRecording: true,
        recording: !!activeRecording,
        finishedRecording: !!lastRecording
    });
});

// --------------------------------------------------
// HOST KONTROLÜ
// --------------------------------------------------

function hostAllowed(url, list) {
    if (!['http:', 'https:'].includes(url.protocol)) {
        return false;
    }

    const host = url.hostname.toLowerCase();

    return list.some(rule =>
        rule === '*' ||
        rule === host ||
        (
            rule.startsWith('*.') &&
            host.endsWith(rule.slice(1))
        )
    );
}

function isAllowed(url) {
    return hostAllowed(url, allowedHosts);
}

// --------------------------------------------------
// YAYIN PROXY
// --------------------------------------------------

function requestStream(
    target,
    headers,
    method,
    res,
    redirectCount
) {
    if (res.destroyed || res.writableEnded) {
        return;
    }

    if (!isAllowed(target)) {
        if (!res.headersSent) {
            return res.status(403).json({
                error: 'Yönlendirilen sunucu izin listesinde değil',
                redirectHost: target.hostname
            });
        }

        return;
    }

    if (redirectCount > MAX_REDIRECTS) {
        if (!res.headersSent) {
            return res.status(508).json({
                error: 'Çok fazla yönlendirme'
            });
        }

        return;
    }

    const client =
        target.protocol === 'https:' ? https : http;

    const proxyRequest = client.request(
        target,
        {
            method,
            headers,
            timeout: 30000
        },
        upstream => {
            const status = upstream.statusCode || 200;

            // YÖNLENDİRME
            if ([301, 302, 303, 307, 308].includes(status)) {
                const location = upstream.headers.location;

                upstream.resume();

                if (!location) {
                    if (!res.headersSent) {
                        return res.status(502).json({
                            error: 'Yönlendirme adresi bulunamadı'
                        });
                    }

                    return;
                }

                let nextUrl;

                try {
                    nextUrl = new URL(location, target);
                } catch {
                    if (!res.headersSent) {
                        return res.status(502).json({
                            error: 'Yönlendirme adresi geçersiz'
                        });
                    }

                    return;
                }

                if (!isAllowed(nextUrl)) {
                    if (!res.headersSent) {
                        return res.status(403).json({
                            error: 'Yönlendirilen sunucu izin listesinde değil',
                            redirectHost: nextUrl.hostname
                        });
                    }

                    return;
                }

                const nextHeaders = { ...headers };

                delete nextHeaders.Authorization;
                delete nextHeaders.authorization;
                delete nextHeaders.Cookie;
                delete nextHeaders.cookie;

                return requestStream(
                    nextUrl,
                    nextHeaders,
                    method,
                    res,
                    redirectCount + 1
                );
            }

            res.status(status);

            [
                'content-type',
                'content-length',
                'content-range',
                'accept-ranges',
                'icy-metaint',
                'icy-name',
                'icy-br'
            ].forEach(key => {
                if (upstream.headers[key]) {
                    res.setHeader(key, upstream.headers[key]);
                }
            });

            res.setHeader(
                'Cache-Control',
                'no-cache, no-store'
            );

            upstream.on('error', err => {
                console.error(
                    'Kaynak yayın hatası:',
                    err.message
                );

                if (!res.destroyed) {
                    res.destroy(err);
                }
            });

            upstream.pipe(res);

            res.on('close', () => {
                if (!upstream.destroyed) {
                    upstream.destroy();
                }
            });
        }
    );

    proxyRequest.on('timeout', () => {
        proxyRequest.destroy(
            new Error('Yayın zaman aşımı')
        );
    });

    proxyRequest.on('error', err => {
        console.error(
            'Yayın köprüsü hatası:',
            err.message
        );

        if (!res.headersSent && !res.destroyed) {
            res.status(502).json({
                error: 'Yayın kaynağına bağlanılamadı',
                detail: err.message
            });
        } else if (!res.destroyed) {
            res.destroy(err);
        }
    });

    res.on('close', () => {
        if (!proxyRequest.destroyed) {
            proxyRequest.destroy();
        }
    });

    proxyRequest.end();
}

// --------------------------------------------------
// STREAM ENDPOINT
// --------------------------------------------------

app.all('/stream', (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    if (!req.query.url) {
        return res.status(400).json({
            error: 'Yayın adresi eksik'
        });
    }

    let target;

    try {
        target = new URL(req.query.url);
    } catch {
        return res.status(400).json({
            error: 'Geçersiz yayın adresi'
        });
    }

    if (!isAllowed(target)) {
        return res.status(403).json({
            error: 'Bu yayın adresine izin verilmiyor',
            host: target.hostname
        });
    }

    const headers = {
        'User-Agent': 'Mozilla/5.0 OnlineRadio/3.5.7',
        'Accept': '*/*',
        'Icy-MetaData':
            req.headers['icy-metadata'] || '0'
    };

    if (req.headers.range) {
        headers.Range = req.headers.range;
    }

    requestStream(
        target,
        headers,
        req.method,
        res,
        0
    );
});

// --------------------------------------------------
// KAYIT URL DÜZENLEME
// --------------------------------------------------

function normalizeRecordStreamUrl(input) {
    const target = new URL(input);

    if (
        target.hostname.toLowerCase() ===
            'sslyayin.netyayin.net' &&
        (
            target.pathname === '/' ||
            target.pathname === ''
        ) &&
        !target.search
    ) {
        target.pathname = '/;';
    }

    return target;
}

// --------------------------------------------------
// DOSYA ADI TEMİZLEME
// --------------------------------------------------

function safeName(value) {
    return String(value || 'Radyo Kaydı')
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9-_ ]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 60) || 'Radyo_Kaydi';
}

// --------------------------------------------------
// KAYDI SONLANDIRMA
// --------------------------------------------------

function finishRecording(reason = 'stopped') {
    if (!activeRecording) {
        return Promise.resolve(
            lastRecording?.filePath || null
        );
    }

    const rec = activeRecording;

    if (rec.finishPromise) {
        return rec.finishPromise;
    }

    rec.finishPromise = new Promise(resolve => {
        const done = () => {
            if (activeRecording === rec) {
                activeRecording = null;
            }

            resolve(rec.filePath);
        };

        rec.proc.once('close', done);

        try {
            if (!rec.proc.killed) {
                rec.proc.kill('SIGINT');
            }
        } catch (err) {
            console.error(
                'FFmpeg durdurma hatası:',
                err.message
            );
        }

        const killTimer = setTimeout(() => {
            try {
                if (!rec.proc.killed) {
                    console.warn(
                        'FFmpeg SIGKILL ile kapatılıyor.'
                    );

                    rec.proc.kill('SIGKILL');
                }
            } catch (_) {}
        }, 8000);

        rec.proc.once('close', () => {
            clearTimeout(killTimer);
        });

        rec.reason = reason;
    });

    return rec.finishPromise;
}

// --------------------------------------------------
// MP3 DOSYASI OLUŞMASINI BEKLEME
// --------------------------------------------------

function waitForAudioFile(
    rec,
    timeoutMs = RECORD_START_TIMEOUT
) {
    return new Promise((resolve, reject) => {
        const started = Date.now();

        const check = () => {
            let size = 0;

            try {
                if (fs.existsSync(rec.filePath)) {
                    size = fs.statSync(rec.filePath).size;
                }
            } catch (_) {}

            if (size >= 4096) {
                return resolve(size);
            }

            if (rec.finished) {
                const details =
                    rec.stderr ||
                    rec.error ||
                    `FFmpeg çıkış kodu: ${
                        rec.exitCode ?? 'bilinmiyor'
                    }, sinyal: ${
                        rec.signal ?? 'yok'
                    }`;

                return reject(new Error(details));
            }

            if (Date.now() - started >= timeoutMs) {
                return reject(
                    new Error(
                        `FFmpeg ${timeoutMs / 1000} saniye içinde ` +
                        `yeterli ses verisi oluşturamadı. ` +
                        `Çıkış kodu: ${rec.exitCode ?? 'bilinmiyor'}. ` +
                        `Ayrıntı: ${rec.stderr || 'FFmpeg hata çıktısı boş'}`
                    )
                );
            }

            setTimeout(check, 300);
        };

        check();
    });
}

// --------------------------------------------------
// SUNUCU TARAFINDA KAYIT BAŞLATMA
// --------------------------------------------------

app.post('/api/record/start', async (req, res) => {
    if (!ffmpegPath) {
        return res.status(503).json({
            error: 'FFmpeg bu sunucuda bulunamadı.'
        });
    }

    if (activeRecording) {
        return res.status(409).json({
            error: 'Sunucuda zaten devam eden bir kayıt var.'
        });
    }

    const {
        streamUrl,
        stationName
    } = req.body || {};

    if (!streamUrl) {
        return res.status(400).json({
            error: 'Yayın adresi gönderilmedi.'
        });
    }

    let target;

    try {
        target = normalizeRecordStreamUrl(streamUrl);
    } catch (err) {
        return res.status(400).json({
            error: 'Geçerli yayın adresi gönderilmedi.',
            detail: err.message
        });
    }

    if (!hostAllowed(target, recordAllowedHosts)) {
        return res.status(403).json({
            error:
                `Bu kanalın sunucuda kaydına izin verilmiyor: ` +
                `${target.hostname}. ` +
                `Render RECORD_ALLOWED_HOSTS ayarını kontrol edin.`
        });
    }

    const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-');

    const fileName =
        `${stamp}_${safeName(stationName)}.mp3`;

    const filePath = path.join(dataDir, fileName);

    console.log('----------------------------------');
    console.log('SUNUCU KAYDI BAŞLATILIYOR');
    console.log('Sürüm:', VERSION);
    console.log('İstasyon:', stationName || 'Radyo Kaydı');
    console.log('Kaynak:', target.href);
    console.log('FFmpeg:', ffmpegPath);
    console.log('Dosya:', filePath);
    console.log('----------------------------------');

    const args = [
        '-hide_banner',
        '-loglevel', 'info',
        '-nostats',
        '-nostdin',
        '-y',

        '-user_agent',
        'Mozilla/5.0 OnlineRadioRecorder/3.5.7',

        '-rw_timeout',
        '25000000',

        '-reconnect',
        '1',

        '-reconnect_streamed',
        '1',

        '-reconnect_delay_max',
        '5',

        '-i',
        target.href,

        '-vn',

        '-codec:a',
        'libmp3lame',

        '-b:a',
        '128k',

        '-f',
        'mp3',

        filePath
    ];

    console.log(
        'FFmpeg komutu:',
        ffmpegPath,
        args.join(' ')
    );

    let proc;

    try {
        proc = spawn(
            ffmpegPath,
            args,
            {
                stdio: ['ignore', 'ignore', 'pipe']
            }
        );
    } catch (err) {
        console.error(
            'FFmpeg spawn hatası:',
            err.stack || err.message
        );

        return res.status(500).json({
            error: 'FFmpeg işlemi başlatılamadı.',
            detail: err.message
        });
    }

    const rec = {
        proc,
        filePath,
        fileName,

        stationName: String(
            stationName || 'Radyo Kaydı'
        ).slice(0, 120),

        startedAt: Date.now(),

        stderr: '',
        finished: false,
        stopRequested: false,

        exitCode: null,
        signal: null,
        error: null
    };

    lastRecording = null;
    activeRecording = rec;

    // FFmpeg STDERR
    proc.stderr.on('data', data => {
        const output = data.toString();

        rec.stderr = (
            rec.stderr + output
        ).slice(-15000);

        console.log('[FFmpeg]', output.trim());
    });

    // FFmpeg başlatma hatası
    proc.once('error', err => {
        console.error(
            'FFmpeg BAŞLATMA HATASI:',
            err.stack || err.message
        );

        rec.error = err.message;
        rec.finished = true;
        rec.closedAt = Date.now();

        lastRecording = rec;

        if (activeRecording === rec) {
            activeRecording = null;
        }
    });

    // FFmpeg kapanma bilgileri
    proc.once('close', (code, signal) => {
        rec.exitCode = code;
        rec.signal = signal;
        rec.finished = true;
        rec.closedAt = Date.now();

        if (rec.maxTimer) {
            clearTimeout(rec.maxTimer);
        }

        lastRecording = rec;

        if (activeRecording === rec) {
            activeRecording = null;
        }

        console.log('----------------------------------');
        console.log('FFmpeg İŞLEMİ KAPANDI');
        console.log('İstasyon:', rec.stationName);
        console.log('Çıkış kodu:', code);
        console.log('Sinyal:', signal);
        console.log('Durdurma nedeni:', rec.reason || 'bilinmiyor');
        console.log('Dosya:', rec.filePath);

        try {
            const fileExists = fs.existsSync(rec.filePath);

            console.log('Dosya mevcut:', fileExists);

            if (fileExists) {
                console.log(
                    'Dosya boyutu:',
                    fs.statSync(rec.filePath).size,
                    'byte'
                );
            }
        } catch (err) {
            console.error(
                'Dosya kontrol hatası:',
                err.message
            );
        }

        console.log(
            'FFmpeg stderr:',
            rec.stderr || '(boş)'
        );

        console.log('----------------------------------');

        if (code !== 0 && !rec.stopRequested) {
            console.error(
                'FFmpeg KAYIT HATASI!',
                'Kod:', code,
                'Sinyal:', signal
            );

            console.error(
                'FFmpeg ayrıntılı çıktı:',
                rec.stderr || '(FFmpeg hata mesajı üretmedi)'
            );
        }
    });

    // Maksimum kayıt süresi: 30 dakika
    rec.maxTimer = setTimeout(() => {
        if (activeRecording === rec) {
            console.log(
                '30 dakikalık maksimum kayıt süresi doldu.'
            );

            finishRecording('maximum-duration').catch(err => {
                console.error(
                    'Maksimum süre durdurma hatası:',
                    err.message
                );
            });
        }
    }, MAX_RECORD_MS);

    // Yayından ses verisi bekleme
    try {
        const bytes = await waitForAudioFile(
            rec,
            RECORD_START_TIMEOUT
        );

        return res.json({
            ok: true,
            recording: true,
            audioConfirmed: true,
            bytes,
            stationName: rec.stationName,
            maxDurationMinutes: 30
        });

    } catch (err) {
        console.error(
            'KAYIT BAŞLATMA BAŞARISIZ:',
            err.message
        );

        if (rec.maxTimer) {
            clearTimeout(rec.maxTimer);
        }

        if (activeRecording === rec) {
            rec.stopRequested = true;

            try {
                await finishRecording('start-failed');
            } catch (_) {}
        }

        if (lastRecording === rec) {
            lastRecording = null;
        }

        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (fileErr) {
            console.error(
                'Geçici kayıt silinemedi:',
                fileErr.message
            );
        }

        return res.status(502).json({
            error:
                'Kayıt başlatılamadı: sunucudan yayın sesi alınamadı.',
            detail: err.message,
            ffmpegError: rec.stderr || null,
            exitCode: rec.exitCode,
            signal: rec.signal
        });
    }
});

// --------------------------------------------------
// KAYIT DURUMU
// --------------------------------------------------

app.get('/api/record/status', (req, res) => {
    const rec = activeRecording || lastRecording;

    let hasFile = false;
    let fileBytes = 0;

    try {
        if (rec && fs.existsSync(rec.filePath)) {
            hasFile = true;
            fileBytes = fs.statSync(rec.filePath).size;
        }
    } catch (err) {
        console.error(
            'Kayıt durum dosya kontrol hatası:',
            err.message
        );
    }

    res.json({
        ok: true,

        recording: !!activeRecording,
        finished: !!rec?.finished,

        hasFile,
        fileBytes,

        stationName: rec?.stationName || null,
        startedAt: rec?.startedAt || null,

        elapsedSeconds: rec
            ? Math.floor(
                (
                    (rec.closedAt || Date.now()) -
                    rec.startedAt
                ) / 1000
            )
            : 0,

        error:
            rec?.error ||
            (
                rec?.exitCode !== null &&
                rec?.exitCode !== undefined &&
                rec.exitCode !== 0
                    ? rec.stderr
                    : null
            ),

        exitCode: rec?.exitCode ?? null,
        signal: rec?.signal ?? null,
        ffmpegOutput: rec?.stderr || null
    });
});

// --------------------------------------------------
// KAYDI DURDURMA VE MP3 İNDİRME
// --------------------------------------------------

app.post('/api/record/stop', async (req, res) => {
    const rec = activeRecording || lastRecording;

    if (!rec) {
        return res.status(409).json({
            error:
                'Sunucuda alınabilecek aktif veya tamamlanmış kayıt bulunamadı. ' +
                'Kayıt başlatma isteği aynı sunucu örneğine ulaşmamış olabilir.'
        });
    }

    if (rec.maxTimer) {
        clearTimeout(rec.maxTimer);
    }

    try {
        if (activeRecording === rec) {
            rec.stopRequested = true;

            await finishRecording('user-stop');
        }

        if (
            !fs.existsSync(rec.filePath) ||
            fs.statSync(rec.filePath).size < 1024
        ) {
            const detail =
                rec.stderr ||
                rec.error ||
                (
                    rec.exitCode !== null &&
                    rec.exitCode !== undefined
                        ? `FFmpeg çıkış kodu: ${rec.exitCode}`
                        : 'Kayıt dosyası boş veya henüz oluşmamış'
                );

            try {
                if (fs.existsSync(rec.filePath)) {
                    fs.unlinkSync(rec.filePath);
                }
            } catch (_) {}

            if (lastRecording === rec) {
                lastRecording = null;
            }

            return res.status(502).json({
                error:
                    'Kayıt dosyası oluşmadı. Yayın adresi sunucuda okunamamış olabilir.',
                detail
            });
        }

        res.setHeader('Content-Type', 'audio/mpeg');

        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${rec.fileName}"`
        );

        res.setHeader('Cache-Control', 'no-store');

        const input = fs.createReadStream(rec.filePath);

        input.on('error', err => {
            console.error(
                'Kayıt dosyası okuma hatası:',
                err.message
            );

            if (!res.headersSent) {
                res.status(500).json({
                    error: 'Kayıt dosyası okunamadı.',
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
});

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
