
const express = require("express");
const cors = require("cors");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "HEAD", "OPTIONS"],
  allowedHeaders: ["Range", "Icy-MetaData"],
  exposedHeaders: [
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "Content-Type",
    "Icy-MetaInt",
    "Icy-Name",
    "Icy-Br"
  ]
}));

// Sunucu kontrolü
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Online Radyo Sunucusu",
    version: "3.1",
    streamProxy: true
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "running" });
});

// HTTPS yayın köprüsü
app.all("/stream", (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const rawUrl = req.query.url;

  if (!rawUrl) {
    return res.status(400).json({
      error: "Yayın adresi eksik"
    });
  }

  let target;

  try {
    target = new URL(rawUrl);
  } catch (e) {
    return res.status(400).json({
      error: "Geçersiz yayın adresi"
    });
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    return res.status(400).json({
      error: "Desteklenmeyen protokol"
    });
  }

  const allowedHosts = (
    process.env.STREAM_PROXY_ALLOWED_HOSTS ||
    "sslyayin.netyayin.net"
  )
    .split(",")
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);

  if (!allowedHosts.includes(target.hostname.toLowerCase())) {
    return res.status(403).json({
      error: "Yayın adresine izin verilmiyor",
      host: target.hostname
    });
  }

  const client = target.protocol === "https:" ? https : http;

  const headers = {
    "User-Agent": "Mozilla/5.0 OnlineRadio/3.1",
    "Accept": "*/*",
    "Icy-MetaData": req.headers["icy-metadata"] || "0"
  };

  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  console.log("Yayın isteği:", target.href);

  const proxyRequest = client.request(target, {
    method: req.method,
    headers,
    timeout: 30000
  }, upstream => {

    // Kaynak sunucunun yönlendirmesini kontrol et
    if ([301, 302, 303, 307, 308].includes(upstream.statusCode)) {
      upstream.resume();

      return res.status(502).json({
        error: "Yayın kaynağı başka bir adrese yönlendiriyor",
        status: upstream.statusCode
      });
    }

    res.status(upstream.statusCode || 200);

    const passHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "icy-metaint",
      "icy-name",
      "icy-br"
    ];

    passHeaders.forEach(name => {
      if (upstream.headers[name]) {
        res.setHeader(name, upstream.headers[name]);
      }
    });

    res.setHeader("Cache-Control", "no-cache, no-store");

    upstream.on("error", err => {
      console.error("Kaynak yayın hatası:", err.message);
      res.destroy(err);
    });

    upstream.pipe(res);
  });

  proxyRequest.on("timeout", () => {
    proxyRequest.destroy(new Error("Yayın zaman aşımı"));
  });

  proxyRequest.on("error", err => {
    console.error("Yayın köprüsü hatası:", err.message);

    if (!res.headersSent) {
      res.status(502).json({
        error: "Yayın kaynağına bağlanılamadı",
        detail: err.message
      });
    } else {
      res.destroy(err);
    }
  });

  // İstemci bağlantısı gerçekten kapanırsa kaynak bağlantısını kes
  res.on("close", () => {
    if (!res.writableEnded) {
      proxyRequest.destroy();
    }
  });

  proxyRequest.end();
});

// Bilinmeyen adresler
app.use((req, res) => {
  res.status(404).json({
    error: "Adres bulunamadı",
    path: req.path
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Online Radyo sunucusu çalışıyor:", PORT);
});
