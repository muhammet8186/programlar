
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
               