# HTML-den-APK

HTML/HTM/ZIP dosyalarını Android uygulamasına dönüştüren herkese açık web platformu. Web arayüzü Render Free üzerinde, Android derlemesi GitHub Actions'ın barındırılan Linux runner'ında çalışır.

## Hazır olan akış

1. Kullanıcı HTML/HTM veya ZIP projesini yükler; uygulama adı, paket kimliği, sürüm ve isteğe bağlı ikon seçer.
2. Render API dosyayı geçici alana kaydeder ve GitHub Actions `workflow_dispatch` çağrısı yapar.
3. GitHub Actions dosyayı ortak gizli anahtarla Render'dan alır, ZIP'i güvenli şekilde açar, Capacitor Android projesi üretir ve Gradle ile derler.
4. APK ve AAB, 7 gün saklanan GitHub Actions artifact paketi olarak yüklenir.
5. GitHub Actions, derleme durumunu Render'a bildirir. Web sayfası durumu otomatik takip eder.
6. Kullanıcı web sayfasındaki indirme bağlantısından APK+AAB ZIP paketini indirir.

## Dağıtım öncesi zorunlu hazırlık

### A. GitHub deposu

1. Bu projenin mevcut deposu `muhammet8186/programlar` olarak kullanılabilir. Özel (private) depo önerilir; Actions kullanım koşullarını ve dakika limitlerini GitHub planınızdan kontrol edin.
2. Depo kökünde `.github/workflows/build-android.yml` bulunmalı; uygulama dosyaları `HTML-den-APK/` altında kalmalıdır.
3. Varsayılan dal `main` olmalıdır (farklıysa Render'daki `GH_BRANCH` değerini değiştirin).
4. Depo → Settings → Actions → General bölümünde workflow izinlerini etkin tutun. Workflow `workflow_dispatch` kullanır.

### B. GitHub Actions secrets ve variables

Depo → Settings → Secrets and variables → Actions bölümünde aşağıdakileri ekleyin.

**Repository secrets**

- `SOURCE_ACCESS_SECRET`: En az 32 karakterlik rastgele gizli değer.
- `BUILD_WEBHOOK_SECRET`: Farklı, en az 32 karakterlik rastgele gizli değer.

**Repository variables** (Render servisi ilk kez yayınlandıktan ve `onrender.com` adresi belli olduktan sonra girin)

- `WEB_BASE_URL`: Render sitenizin tam adresi, ör. `https://html-den-apk.onrender.com` (sonunda `/` olmasın).
- `WEB_CALLBACK_URL`: `WEB_BASE_URL` + `/api/build-callback`.

Örnek Render ortam değişkenleri için `.env.example` dosyasına bakın; gerçek `.env` dosyasını GitHub'a yüklemeyin.

### C. Render Blueprint

1. Render → New → Blueprint seçin ve GitHub deposunu bağlayın.
2. `render.yaml` dosyası ücretsiz Node web servisini oluşturur.
3. Render servisinin Environment bölümüne şu değerleri girin:
   - `GH_TOKEN`: GitHub Fine-grained Personal Access Token.
   - `GH_OWNER`: GitHub kullanıcı veya organizasyon adı.
   - `GH_REPO`: Depo adı (`html-den-apk`).
   - `GH_BRANCH`: `main`.
   - `SOURCE_ACCESS_SECRET`: GitHub repository secret ile birebir aynı.
   - `BUILD_WEBHOOK_SECRET`: GitHub repository secret ile birebir aynı.
4. Fine-grained token'ı yalnızca ilgili depoya sınırlandırın. Repository permissions: **Actions: Read and write**, **Contents: Read-only**. Token'ı HTML/JS dosyalarına veya GitHub deposuna yazmayın.
5. Render servis adresini alın; GitHub Actions variables bölümünde `WEB_BASE_URL` ve `WEB_CALLBACK_URL` değerlerini tanımlayın.
6. Render'da yeniden deploy edin. `/api/health` yanıtında `buildEngine: "configured"` görünmelidir.

> `SOURCE_ACCESS_SECRET` ve `BUILD_WEBHOOK_SECRET` iki ayrı amaç için kullanılır. Aynı değeri kullanmayın. Bu değerleri parola yöneticisiyle üretin; herkese açık sohbet veya kod içine koymayın.

## Ücretsiz plan ve saklama notları

- Web arayüzü Render Free'de çalışabilir; boşta kalınca uyur ve dosya sistemi kalıcı değildir.
- Yüklenen kaynak proje, derleme tamamlanana kadar Render'ın geçici diskinde tutulur. Servis uyku/yeniden başlatma veya dağıtım sırasında dosya kaybolursa o derleme başarısız olabilir. Üretim güvenilirliği için daha sonra S3 uyumlu nesne depolama eklenmelidir.
- Derleme GitHub-hosted runner'da yapılır. GitHub Actions ücretsiz kullanım/dakika ve eşzamanlılık koşulları hesap türüne ve depo görünürlüğüne bağlıdır; sınırsız kaynak garantisi değildir.
- Kullanıcıya günlük kota konulmaz; API hız sınırlaması, 20 MB yükleme sınırı, 100 MB açılmış ZIP sınırı, 2.000 dosya sınırı ve GitHub runner süre sınırı gibi altyapı korumaları vardır.
- Artifact paketleri 7 gün sonra silinir. İndirme paketi ZIP biçimindedir ve içinde APK ile AAB bulunur.
- APK, `assembleDebug` ile üretilen test/kurulum paketidir. AAB, `bundleRelease` ile üretilen release bundle'dır; Play Store'a göndermeden önce kendi güvenli release anahtarınızla imzalama/Play App Signing süreci tamamlanmalıdır. Kullanıcılara ortak özel imzalama anahtarı dağıtılmaz.

## Yerel geliştirme

- Node.js 20 veya üzeri
- `npm install`
- `npm start`
- `http://localhost:3000`

## Sağlık kontrolü ve API

- `GET /api/health` — web/derleme bağlantısı durumu
- `POST /api/projects` — multipart: `project`, `icon` (isteğe bağlı), `appName`, `packageName`, `version`
- `GET /api/jobs/:id` — derleme durumu
- `GET /api/jobs/:id/download` — APK+AAB artifact ZIP indirme
- `GET /api/build-source/:id` — yalnızca GitHub Actions ortak gizli anahtarıyla kaynak indirme
- `GET /api/build-icon/:id` — yalnızca GitHub Actions ortak gizli anahtarıyla logo indirme
- `POST /api/build-callback` — yalnızca webhook gizli anahtarıyla durum bildirimi

## Güvenlik notları

Yüklenen HTML/JavaScript Android WebView içinde çalıştırılır; platform, yüklenen projelerin davranışını garanti etmez. Yalnızca sahibi olduğunuz veya dağıtım izniniz olan projeleri paketleyin. Genel kullanıma açmadan önce kötüye kullanım, zararlı içerik taraması, gizlilik bildirimi, hizmet koşulları ve kaynak depolama/temizleme politikası eklenmelidir.
