const express = require("express");
const dns = require("dns").promises;
const net = require("net");
const { spawn } = require("child_process");
const FFMPEG = require("ffmpeg-static");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_URL_LENGTH = 4096;
const MAX_CONCURRENT_STREAMS = Number(process.env.MAX_CONCURRENT_STREAMS || 4);
const active = new Set();

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  return p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255) ||
    p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

function isPrivateIPv6(ip) {
  const x = ip.toLowerCase();
  return x === "::" || x === "::1" || x.startsWith("fc") ||
    x.startsWith("fd") || x.startsWith("fe8") ||
    x.startsWith("fe9") || x.startsWith("fea") ||
    x.startsWith("feb") || x.startsWith("::ffff:127.") ||
    x.startsWith("::ffff:10.") || x.startsWith("::ffff:192.168.");
}

async function validatePublicUrl(raw) {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) {
    throw new Error("Yayın adresi eksik veya çok uzun.");
  }

  let u;
  try { u = new URL(raw); } catch { throw new Error("Geçersiz yayın adresi."); }

  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Yalnızca HTTP ve HTTPS yayınları desteklenir.");
  }
  if (u.username || u.password) {
    throw new Error("Kullanıcı adı/şifre içeren yayın adresleri desteklenmiyor.");
  }

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Yerel ağ adreslerine izin verilmiyor.");
  }

  if (net.isIP(host)) {
    if ((net.isIP(host) === 4 && isPrivateIPv4(host)) ||
        (net.isIP(host) === 6 && isPrivateIPv6(host))) {
      throw new Error("Özel veya yerel IP adreslerine izin verilmiyor.");
    }
  } else {
    let records;
    try { records = await dns.lookup(host, { all: true, verbatim: true }); }
    catch { throw new Error("Yayın sunucusunun DNS adresi çözümlenemedi."); }

    if (!records.length || records.some(r =>
      (net.isIP(r.address) === 4 && isPrivateIPv4(r.address)) ||
      (net.isIP(r.address) === 6 && isPrivateIPv6(r.address)))) {
      throw new Error("Yayın adresi genel internete ait görünmüyor.");
    }
  }

  u.hash = "";
  return u.toString();
}

app.get("/", (_req, res) => {
  res.type("text").send("STREAM PULSE PRO Universal Radio Proxy hazır.");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "stream-pulse-proxy",
    version: "2.0.0",
    formats: ["MP3", "AAC", "AAC+", "HLS/M3U8"],
    activeStreams: active.size
  });
});

app.get("/stream", async (req, res) => {
  let source;
  try {
    if (!req.query.url) return res.status(400).type("text").send("url parametresi gerekli.");
    source = await validatePublicUrl(String(req.query.url));
  } catch (e) {
    return res.status(400).type("text").send(e.message);
  }

  if (active.size >= MAX_CONCURRENT_STREAMS) {
    return res.status(503).type("text").send("Sunucu yayın kapasitesine ulaştı. Daha sonra tekrar deneyin.");
  }

  res.status(200);
  res.set({
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline"
  });

  // FFmpeg, HLS ana listesini ve segmentlerini takip eder.
  // Yalnızca ağ tabanlı protokoller açılır; dosya/pipe gibi yerel protokoller kapalıdır.
  const args = [
    "-hide_banner", "-loglevel", "warning",
    "-user_agent", "Mozilla/5.0 (compatible; StreamPulseRadio/2.0)",
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    "-protocol_whitelist", "http,https,tcp,tls,crypto",
    "-i", source,
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    "-ac", "2", "-ar", "44100",
    "-codec:a", "libmp3lame", "-b:a", "128k",
    "-f", "mp3", "pipe:1"
  ];

  const ff = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
  active.add(ff);
  let gotAudio = false;
  let ended = false;

  ff.stdout.on("data", chunk => {
    gotAudio = true;
    if (!res.destroyed) res.write(chunk);
  });

  ff.stderr.on("data", chunk => {
    const msg = chunk.toString().trim();
    if (msg) console.error("[ffmpeg]", msg);
  });

  function stop() {
    if (ended) return;
    ended = true;
    active.delete(ff);
    if (!ff.killed) ff.kill("SIGTERM");
  }

  ff.on("error", err => {
    console.error("FFmpeg başlatılamadı:", err);
    if (!res.headersSent) res.status(500);
    if (!res.destroyed) res.end("Ses dönüştürücü başlatılamadı.");
    stop();
  });

  ff.on("close", code => {
    active.delete(ff);
    if (!res.destroyed) {
      if (!gotAudio && code !== 0) {
        // Headers already started for streaming; end with a clear server-side log.
        console.error("Yayın açılamadı/dönüştürülemedi. FFmpeg çıkış kodu:", code);
      }
      res.end();
    }
  });

  res.on("close", stop);
});

app.listen(PORT, () => {
  console.log(`STREAM PULSE PRO Universal Proxy ${PORT} portunda hazır.`);
});
