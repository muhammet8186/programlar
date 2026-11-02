const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// Geçici kayıtların tutulacağı klasör
const RECORD_DIR = path.join(__dirname, 'recordings');
if (!fs.existsSync(RECORD_DIR)) {
    fs.mkdirSync(RECORD_DIR, { recursive: true });
}

// Aktif kayıt süreçlerini tutan sözlük { recordingId: { process, filePath, stationName, startTime } }
const activeRecordings = new Map();

// 1. Sağlık Kontrolü (Render Uyku Modunu Önleme / Test Etme)
app.get('/health', (req, res) => {
    res.json({
        service: 'Online Radyo Kayıt Sunucusu',
        status: 'çalışıyor',
        version: '1.0.0',
        activeRecordings: activeRecordings.size,
        timestamp: Date.now()
    });
});

// 2. HTTP Akışlarını HTTPS / CORS Engeline Takılmadan Aktarma Köprüsü (Stream Proxy)
app.get('/stream', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Eksik parametre: url');
    }

    try {
        const fetchModule = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const response = await fetchModule(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        if (!response.ok) {
            return res.status(response.status).send(`Yayın sunucusu hata döndürdü: ${response.statusText}`);
        }

        // Ses akışı başlıklarını ilet
        res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');

        response.body.pipe(res);

        req.on('close', () => {
            if (response.body && typeof response.body.destroy === 'function') {
                response.body.destroy();
            }
        });
    } catch (err) {
        console.error('Stream proxy hatası:', err.message);
        if (!res.headersSent) {
            res.status(500).send('Yayın akışı alınamadı: ' + err.message);
        }
    }
});

// 3. Sunucu Üzerinden Kaydı Başlatma (/api/record/start)
app.post('/api/record/start', (req, res) => {
    const { streamUrl, stationName } = req.body;
    const deviceId = req.headers['x-device-id'] || 'anonim';

    if (!streamUrl) {
        return res.status(400).json({ error: 'Geçerli bir yayın adresi (streamUrl) gerekli.' });
    }

    const recordingId = 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const safeName = (stationName || 'Radyo_Kaydi').replace(/[^a-zA-Z0-9-_]/g, '_');
    const filePath = path.join(RECORD_DIR, `${recordingId}_${safeName}.mp3`);

    // FFmpeg kullanarak akışı mp3 olarak kaydetme (Render ortamında ffmpeg kurulu olmalıdır)
    // Not: Render sunucusunda ffmpeg yoksa apt-get ile yüklenmeli veya buildpack kullanılmalıdır.
    const ffmpegProcess = spawn('ffmpeg', [
        '-i', streamUrl,
        '-t', '1800', // Güvenlik maksadıyla en fazla 30 dakika sınır
        '-acodec', 'copy',
        filePath
    ]);

    ffmpegProcess.on('error', (err) => {
        console.error('FFmpeg başlatılamadı:', err);
    });

    activeRecordings.set(recordingId, {
        process: ffmpegProcess,
        filePath,
        stationName: safeName,
        startTime: Date.now(),
        deviceId
    });

    console.log(`[Kayıt Başladı] ID: ${recordingId}, Kanal: ${stationName}`);
    return res.json({ success: true, id: recordingId });
});

// 4. Kayıt Durumunu Kontrol Etme (/api/record/status)
app.get('/api/record/status', (req, res) => {
    const { id } = req.query;
    if (!id || !activeRecordings.has(id)) {
        return res.json({ recording: false, error: 'Kayıt oturumu bulunamadı veya sonlandırıldı.' });
    }
    res.json({ recording: true });
});

// 5. Kaydı Durdurma ve Dosyayı İstemciye Gönderme (/api/record/stop)
app.post('/api/record/stop', async (req, res) => {
    const { id } = req.body;
    if (!id || !activeRecordings.has(id)) {
        return res.status(404).json({ error: 'Aktif kayıt bulunamadı.' });
    }

    const session = activeRecordings.get(id);
    activeRecordings.delete(id);

    try {
        // FFmpeg sürecini güvenli şekilde sonlandır
        if (session.process && !session.process.killed) {
            session.process.kill('SIGINT');
        }

        // Dosyanın yazılması için kısa bir süre bekle
        await new Promise(resolve => setTimeout(resolve, 1500));

        if (!fs.existsSync(session.filePath) || fs.statSync(session.filePath).size === 0) {
            return res.status(500).json({ error: 'Kayıt dosyası oluşturulamadı veya boyutu çok küçük.' });
        }

        console.log(`[Kayıt Tamamlandı] Dosya gönderiliyor: ${session.filePath}`);
        
        res.download(session.filePath, `${session.stationName}.mp3`, (err) => {
            // Gönderim bittikten sonra sunucudaki geçici dosyayı temizle
            setTimeout(() => {
                try {
                    if (fs.existsSync(session.filePath)) fs.unlinkSync(session.filePath);
                } catch (e) {
                    console.warn('Geçici dosya silinemedi:', e);
                }
            }, 5000);
            
            if (err && !res.headersSent) {
                console.error('Dosya indirme hatası:', err);
            }
        });

    } catch (err) {
        console.error('Kayıt durdurma hatası:', err);
        res.status(500).json({ error: 'Kayıt sonlandırılırken hata oluştu: ' + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Radyo kayıt sunucusu ${PORT numaralı} portta çalışıyor.`);
});
