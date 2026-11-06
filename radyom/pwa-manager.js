(function () {
  "use strict";

  const CONFIG = Object.assign({
    appName: "STREAM PULSE PRO",
    version: "1.0.0",
    serviceWorker: "./sw.js",
    checkInterval: 60 * 60 * 1000,
    showInstallButton: true,
    showFullscreenButton: false,
    autoCheckUpdates: true
  }, window.PWA_CONFIG || {});

  let deferredPrompt = null;
  let registration = null;
  let reloading = false;
  let updateNoticeShown = false;

  const style = document.createElement("style");
  style.textContent = `
    #sp-pwa-controls {
      position: fixed; right: 14px; bottom: 14px; z-index: 99990;
      display: flex; flex-direction: column; gap: 8px;
      font-family: Inter, Arial, sans-serif;
    }
    .sp-pwa-btn {
      border: 1px solid rgba(255,255,255,.18); border-radius: 12px;
      padding: 10px 14px; color: #07111c; font-size: 12px;
      font-weight: 800; cursor: pointer; box-shadow: 0 5px 18px #0005;
      background: #00f2fe;
    }
    .sp-pwa-btn.secondary { color: #f8fafc; background: #1e293b; }
    #sp-pwa-notice {
      display: none; position: fixed; left: 50%; bottom: 100px;
      transform: translateX(-50%); width: min(360px, calc(100% - 28px));
      box-sizing: border-box; z-index: 100000; padding: 16px;
      border: 1px solid rgba(0,242,254,.45); border-radius: 16px;
      background: #0f172a; color: #f8fafc; font: 13px/1.5 Inter, Arial, sans-serif;
      box-shadow: 0 12px 35px #0009;
    }
    #sp-pwa-notice button {
      border: 0; border-radius: 9px; padding: 9px 12px;
      margin: 12px 7px 0 0; font-weight: 800; cursor: pointer;
    }
    #sp-pwa-notice .confirm { background: #00f2fe; color: #07111c; }
    #sp-pwa-notice .later { background: #334155; color: white; }
    @media (max-width: 480px) {
      #sp-pwa-controls { right: 9px; bottom: 9px; }
      .sp-pwa-btn { padding: 9px 11px; font-size: 11px; }
    }
  `;
  document.head.appendChild(style);

  function isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.navigator.standalone === true;
  }

  function closeNotice() {
    const box = document.getElementById("sp-pwa-notice");
    if (box) box.style.display = "none";
  }

  function notify(message, actions) {
    const box = document.getElementById("sp-pwa-notice");
    if (!box) return;
    box.replaceChildren();

    const text = document.createElement("div");
    text.textContent = message;
    box.appendChild(text);

    (actions || []).forEach(action => {
      const button = document.createElement("button");
      button.textContent = action.label;
      button.className = action.className || "later";
      button.addEventListener("click", action.run);
      box.appendChild(button);
    });

    box.style.display = "block";
  }

  function createInterface() {
    if (document.getElementById("sp-pwa-controls")) return;

    const controls = document.createElement("div");
    controls.id = "sp-pwa-controls";

    if (CONFIG.showInstallButton && !isInstalled()) {
      const install = document.createElement("button");
      install.className = "sp-pwa-btn";
      install.id = "sp-pwa-install";
      install.textContent = "📲 Uygulamayı yükle";
      install.addEventListener("click", installApp);
      controls.appendChild(install);
    }

    if (CONFIG.showFullscreenButton) {
      const fullscreen = document.createElement("button");
      fullscreen.className = "sp-pwa-btn secondary";
      fullscreen.id = "sp-pwa-fullscreen";
      fullscreen.textContent = "⛶ Tam ekran";
      fullscreen.addEventListener("click", toggleFullscreen);
      controls.appendChild(fullscreen);
    }

    document.body.appendChild(controls);

    const notice = document.createElement("div");
    notice.id = "sp-pwa-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    document.body.appendChild(notice);
  }

  async function installApp() {
    if (isInstalled()) {
      notify("STREAM PULSE PRO zaten uygulama olarak açık.");
      return;
    }

    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      console.log("PWA kurulum sonucu:", result.outcome);
      deferredPrompt = null;
      if (result.outcome === "accepted") {
        const button = document.getElementById("sp-pwa-install");
        if (button) button.remove();
      }
      return;
    }

    const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isAppleMobile) {
      notify("Safari'de Paylaş düğmesine dokunun, ardından “Ana Ekrana Ekle” seçeneğini seçin.");
    } else {
      notify("Kurulum seçeneği henüz tarayıcı tarafından sunulmadı. Chrome veya Edge menüsünden “Uygulamayı yükle” ya da “Ana ekrana ekle” seçeneğini kullanın. Sayfayı HTTPS üzerinden açtığınızdan emin olun.");
    }
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event;
    const button = document.getElementById("sp-pwa-install");
    if (button) button.textContent = "📲 STREAM PULSE PRO'yu yükle";
  });

  window.addEventListener("appinstalled", () => {
    const button = document.getElementById("sp-pwa-install");
    if (button) button.remove();
    notify("STREAM PULSE PRO başarıyla yüklendi!");
  });

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else {
        notify("Bu tarayıcı gerçek tam ekran API'sini desteklemiyor. Yüklü uygulama modu tarayıcı çubuklarını zaten gizler.");
      }
    } catch (error) {
      console.warn("Tam ekran isteği:", error);
      notify("Tam ekran isteği reddedildi. Butona tekrar dokunarak deneyin.");
    }
  }

  document.addEventListener("fullscreenchange", () => {
    const button = document.getElementById("sp-pwa-fullscreen");
    if (button) button.textContent = document.fullscreenElement ? "⛶ Tam ekrandan çık" : "⛶ Tam ekran";
  });

  function showUpdateNotice() {
    if (updateNoticeShown) return;
    updateNoticeShown = true;
    notify("STREAM PULSE PRO için yeni sürüm hazır. Güncelleme sırasında sayfa yenilenecek.", [
      {
        label: "Şimdi güncelle",
        className: "confirm",
        run: () => {
          if (registration && registration.waiting) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
          } else {
            closeNotice();
          }
        }
      },
      { label: "Daha sonra", className: "later", run: closeNotice }
    ]);
  }

  async function checkForUpdates() {
    if (!registration) return;
    try {
      await registration.update();
    } catch (error) {
      console.warn("PWA güncelleme kontrolü yapılamadı:", error);
    }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      console.warn("Bu tarayıcı Service Worker desteklemiyor.");
      return;
    }
    if (!window.isSecureContext) {
      console.warn("PWA kurulumu için HTTPS veya localhost gerekir.");
      return;
    }

    try {
      registration = await navigator.serviceWorker.register(CONFIG.serviceWorker, {
        scope: "./",
        updateViaCache: "none"
      });

      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateNotice();
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateNotice();
          }
        });
      });

      if (CONFIG.autoCheckUpdates) {
        await checkForUpdates();
        window.setInterval(checkForUpdates, CONFIG.checkInterval);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdates();
        });
      }
    } catch (error) {
      console.error("PWA Service Worker kayıt hatası:", error);
    }
  }

  window.PWAManager = {
    install: installApp,
    fullscreen: toggleFullscreen,
    checkUpdate: checkForUpdates,
    isInstalled
  };

  function start() {
    createInterface();
    registerServiceWorker();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
