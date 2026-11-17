const express = require("express");
const { spawn } = require("child_process");
const net = require("net");

const app = express();
const PORT = process.env.PORT || 3000;
const FFMPEG = require("ffmpeg-static");

// Güvenlik: yalnızca tanımlanan yayın sunucularına izin verilir.
// Render ortam değişkeni ALLOWED_HOSTS içine virgülle ayrılmış alan adları/IP'ler yazılabilir.
const allowedHosts = (process.env.ALLOWED_HOSTS || "46.20.3.201,stream.rcast.net")
  .split(",").map(x => x.trim().toLowerCase()).filter(Boolean);

function isPrivateIPv4(host) {
  if (net.isIP(host) !== 4) return false;
  const p = host.split(".").map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || p[0] >= 224;
}

function validateStream(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("Geçersiz yayın adresi."); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Yalnızca HTTP/HTTPS yayınları desteklenir.");
  const host = u.hostname.toLowerCase();
  if (isPrivateIPv4(host)) throw new Error("Yerel ağ adreslerine izin verilmiyor.");
  if (!allowedHosts.includes(host)) throw new Error("Bu yayın sunucusu izin listesinde değil. ALLOWED_HOSTS ayarını güncelleyin.");
  return u.toString();
}

app.get("/", (_req, res) => {
  res.type("text").send("STREAM PULSE PRO yayın dönüştürücü hazır.");
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "stream-pulse-proxy" }));

app.get("/stream", (req, res) => {
  let source;
  try {
    if (!req.query.url) return res.status(400).send("url parametresi gerekli.");
    source = validateStream(String(req.query.url));
  } catch (e) {
    return res.status(400).type("text").send(e.message);
  }

  res.status(200);
  res.set({
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff"
  });

  const args = [
    "-hide_banner", "-loglevel", "error",
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    "-i", source,
    "-vn", "-ac", "2", "-ar", "44100",
    "-codec:a", "libmp3lame", "-b:a", "128k",
    "-f", "mp3", "pipe:1"
  ];

  const ff = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
  let headersSent = false;

  ff.stdout.on("data", chunk => {
    headersSent = true;
    if (!res.destroyed) res.write(chunk);
  });
  ff.stderr.on("data", chunk => console.error("[ffmpeg]", chunk.toString().trim()));
  ff.on("error", err => {
    console.error("FFmpeg başlatılamadı:", err);
    if (!headersSent && !res.headersSent) res.status(500).end("Ses dönüştürücü başlatılamadı.");
    else res.destroy(err);
  });
  ff.on("close", code => {
    if (!res.destroyed) {
      if (!headersSent && code !== 0) res.status(502).end("Yayın alınamadı veya dönüştürülemedi.");
      else res.end();
    }
  });

  req.on("close", () => {
    if (!ff.killed) ff.kill("SIGTERM");
  });
});

app.listen(PORT, () => console.log(`STREAM PULSE PRO proxy ${PORT} portunda hazır.`));
