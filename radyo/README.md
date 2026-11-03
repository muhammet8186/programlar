ONLINE RADYO SUNUCU 3.5.2 - RENDER KURULUM

Bu arşiv kök dizine göre düzenlenmiştir. ZIP'i GitHub deposuna yüklerken
server.js, package.json ve Radyo.html dosyaları depo kökünde bulunmalıdır.

Render ayarları:
- New + Web Service
- GitHub deposunu seç
- Runtime: Node
- Build Command: npm install
- Start Command: npm start
- Health Check Path: /health
- Node sürümü: 20 (render.yaml bunu tanımlar)

Render otomatik deploy için render.yaml dosyasını kullanabilir. Elle kurulumda
aynı komutları girin.

Önemli:
- Render'da RECORD_ALLOWED_HOSTS ve STREAM_PROXY_ALLOWED_HOSTS ortam
  değişkenlerini yayın kaynağınızın gerçek hostname'ine göre ayarlayın.
- ffmpeg-static npm kurulumu sırasında platforma uygun FFmpeg ikilisini indirir.
- Render Free servis uykuya geçebilir; sürekli yayın/kayıt için ücretli ve
  uygun disk/çalışma planı gerekebilir.
- Render'ın geçici dosya sistemi kalıcı değildir. Kayıtların kalıcı olması için
  Render Persistent Disk bağlayıp RECORDINGS_DIR veya RENDER_DISK_PATH ayarlayın.
- / ve /health adresleri servis durumunu JSON olarak döndürür.

ONLINE RADYO SUNUCU 3.5.1 — KURULUM VE GÜVENLİK

PAKET İÇERİĞİ
- Radyo.html: Web radyo arayüzü (mevcut özellikler korunmuştur).
- server.js: Yayın proxy'si ve FFmpeg tabanlı MP3 kayıt servisi.
- package.json: Node.js bağımlılıkları ve çalıştırma komutu.
- .env.example: Ortam değişkenleri örneği.

RENDER / NODE KURULUMU
1. GitHub deposundaki server.js, package.json ve Radyo.html dosyalarını bu pakettekilerle değiştirin.
2. Node.js sürümü 20 veya üstü olmalıdır.
3. Build komutu: npm install
4. Start komutu: npm start (Render için: node server.js)
5. Deploy tamamlanınca https://<servis-adresiniz>/ adresinde version: 3.5.1,
   streamProxy: true ve serverRecording: true görünmelidir.
6. /health adresi servis durumunu verir.

ORTAM DEĞİŞKENLERİ
STREAM_PROXY_ALLOWED_HOSTS: Proxy üzerinden çalınmasına izin verilen hostlar.
RECORD_ALLOWED_HOSTS: Sunucu üzerinden kaydedilmesine izin verilen hostlar.
RECORDINGS_DIR: Kayıt klasörü (isteğe bağlı).
RENDER_DISK_PATH: Render kalıcı disk yolu; recordings alt klasörü oluşturulur.

GÜVENLİK NOTU
- RECORD_ALLOWED_HOSTS=* tüm hostlara kayıt izni verir; kötüye kullanıma ve sunucunun
  istenmeyen adreslere bağlantı kurmasına yol açabilir. Tercihen sadece gerekli yayın
  sunucularının alan adlarını yazın.
- STREAM_PROXY_ALLOWED_HOSTS ve RECORD_ALLOWED_HOSTS değerlerini birbirinden ayrı
  tutabilirsiniz.
- Render üzerinde kayıtların deploy sonrasında kalması için Persistent Disk bağlayıp
  RECORDINGS_DIR veya RENDER_DISK_PATH ayarlayın. Disk yoksa geçici dosyalar kaybolabilir.
- Bu uygulama canlı Render ortamında test edilmemiştir; ilk kayıt denemesini kısa tutup
  Render Logs ve /api/record/status çıktısını kontrol edin.

KAYIT DAVRANIŞI
- Kayıt başlatma isteği FFmpeg'in MP3'e en az 4096 bayt yazmasını bekler (15 saniye).
- Ses doğrulanamazsa API başarısız yanıt ve ayrıntı döndürür; sahte başarı bildirmez.
- Maksimum kayıt süresi 30 dakikadır.
- SIGTERM/SIGINT sırasında FFmpeg'in dosyayı düzgün kapatması denenir.

