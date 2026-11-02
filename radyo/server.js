
const express = require("express");
const cors = require("cors");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const app = express();

const PORT = process.env.PORT || 3000;
const MAX_REDIRECTS = 5;

const allowedHosts = (
  process.env.STREAM_PROXY_ALLOWED_HOSTS ||
  "sslyayin.netyayin.net"
)
  .split(",")
  .map(host => host.trim().toLowerCase())
  .filter(Boolean);

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

// Ana sunucu kontrolü
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Online Radyo Sunucusu",
    version: "3.2",
    streamProxy: true,
    redirectSupport: true
  });
});

// Sağlık kontrolü
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "running",
    version: "3.2"
  });
});

// İzin kontrolü
function isAllowed(url) {
  return (
    ["http:", "https:"].includes(url.protocol) &&
    allowedHosts.includes(url.hostname.toLowerCase())
  );
}

// HTTP / HTTPS isteği
function requestStream(target, headers, method, res, redirectCount) {
  if (res.destroyed || res.writableEnded) return;

  if (!isAllowed(target)) {
    if (!res.headersSent) {
      res.status(403).json({
        error: "Yönlendirilen sunucu izin listesinde değil",
        redirectHost: target.hostname
      });
    }
    return;
  }

  if (redirectCount > MAX_REDIRECTS) {
    if (!res.headersSent) {
      res.status(508).json({
        error: "Çok fazla yönlendirme"
      });
    }
    return;
  }

  const client = target.protocol === "https:" ? https : http;

  console.log(
    "Yayın isteği:",
    target.hostname,
    target.pathname,
    "Yönlendirme:",
    redirectCount
  );

  const proxyRequest = client.request(target, {
    method,
    headers,
    timeout: 30000
  }, upstream => {

    const status = upstream.statusCode || 200;

    // Yönlendirmeleri takip et
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = upstream.headers.location;
      upstream.resume();

      if (!location) {
        if (!res.headersSent) {
          res.status(502).json({
            error: "Yönlendirme adresi bulunamadı"
          });
        }
        return;
      }

      let nextUrl;

      try {
        nextUrl = new URL(location, target);
      } catch {
        if (!res.headersSent) {
          res.status(502).json({
            error: "Yönlendirme adresi geçersiz"
          });
        }
        return;
      }

      console.log(
        "Yayın yönlendirmesi:",
        nextUrl.hostname
      );

      if (!isAllowed(nextUrl)) {
        if (!res.headersSent) {
          res.status(403).json({
            error: "Yönlendirilen sunucu izin listesinde değil",
            redirectHost: nextUrl.hostname
          });
        }
        return;
      }

      const nextHeaders = { ...headers };

      // Başka sunucuya geçerken hassas başlık aktarma
      delete nextHeaders.Authorization;
      delete nextHeaders.authorization;
      delete nextHeaders.Cookie;
      delete nextHeaders.cookie;

      // POST yönlendirmesi olmadığı için Range korunabilir
      return requestStream(
        nextUrl,
        nextHeaders,
        method,
        res,
        redirectCount + 1
      );
    }

    // Kaynak yanıtı
    res.status(status);

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

      if (!res.destroyed) {
        res.destroy(err);
      }
    });

    upstream.pipe(res);

    res.on("close", () => {
      if (!upstream.destroyed) {
        upstream.destroy();
      }
    });
  });

  proxyRequest.on("timeout", () => {
    proxyRequest.destroy(new Error("Yayın zaman aşımı"));
  });

  proxyRequest.on("error", err => {
    console.error("Yayın köprüsü hatası:", err.message);

    if (!res.headersSent && !res.destroyed) {
      res.status(502).json({
        error: "Yayın kaynağına bağlanılamadı",
        detail: err.message
      });
    } else if (!res.destroyed) {
      res.destroy(err);
    }
  });

  res.on("close", () => {
    if (!proxyRequest.destroyed) {
      proxyRequest.destroy();
    }
  });

  proxyRequest.end();
}

// Yayın köprüsü
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
  } catch {
    return res.status(400).json({
      error: "Geçersiz yayın adresi"
    });
  }

  if (!isAllowed(target)) {
    return res.status(403).json({
      error: "Bu yayın adresine izin verilmiyor",
      host: target.hostname
    });
  }

  const headers = {
    "User-Agent": "Mozilla/5.0 OnlineRadio/3.2",
    "Accept": "*/*",
    "Icy-MetaData": req.headers["icy-metadata"] || "0"
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

// Bilinmeyen adresler
app.use((req, res) => {
  res.status(404).json({
    error: "Adres bulunamadı",
    path: req.path
  });
});

app.listen(PORT, () => {
  console.log("Online Radyo sunucusu başlatıldı.");
  console.log("Sürüm: 3.2");
  console.log("Port:", PORT);
  console.log("İzinli sunucular:", allowedHosts);
});
