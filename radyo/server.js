
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

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Online Radyo Sunucusu",
    version: "3.0",
    streamProxy: true
  });
});

app.all("/stream", (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawUrl = req.query.url;

  if (!rawUrl) {
    return res.status(400).json({ error: "Yayın adresi eksik" });
  }

  let target;

  try {
    target = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: "Geçersiz yayın adresi" });
  }

  const allowedHosts = (
    process.env.STREAM_PROXY_ALLOWED_HOSTS ||
    "sslyayin.netyayin.net"
  ).split(",").map(x => x.trim().toLowerCase());

  if (
    target.protocol !== "http:" &&
    target.protocol !== "https:"
  ) {
    return res.status(400).json({ error: "Desteklenmeyen protokol" });
  }

  if (!allowedHosts.includes(target.hostname.toLowerCase())) {
    return res.status(403).json({ error: "Bu yayın adresine izin verilmiyor" });
  }

  const client = target.protocol === "https:" ? https : http;

  const headers = {
    "User-Agent": "Mozilla/5.0 OnlineRadio/3.0",
    "Accept": "*/*",
    "Icy-MetaData": req.headers["icy-metadata"] || "0"
  };

  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  const proxyRequest = client.request(target, {
    method: req.method,
    headers,
    timeout: 30000
  }, upstream => {
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
    upstream.pipe(res);
  });

  proxyRequest.on("timeout", () => {
    proxyRequest.destroy(new Error("Yayın zaman aşımı"));
  });

  proxyRequest.on("error", err => {
    console.error("Yayın köprüsü:", err.message);

    if (!res.headersSent) {
      res.status(502).json({
        error: "Yayın kaynağına bağlanılamadı"
      });
    } else {
      res.destroy(err);
    }
  });

  req.on("close", () => {
    if (!res.writableEnded) {
      proxyRequest.destroy();
    }
  });

  proxyRequest.end();
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Online Radyo sunucusu çalışıyor:", PORT);
});
