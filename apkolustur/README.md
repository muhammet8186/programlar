# Kendi APK Oluşturucumuz (0.2.0)

## Repo içi konum
Bu klasör `programlar/apkolustur` altında tutulur. Render servisini Docker runtime ile oluşturun.

## Render ayarı
- Runtime: Docker
- Dockerfile Path (repo kökünden): `apkolustur/Dockerfile`
- Docker Context: `apkolustur`
- Health Check Path: `/api/health`
- Plan: APK derleme için en az 2 GB RAM önerilir; Render free instance APK derleme için uygun değildir.

Eğer Render servisi bu klasörün Root Directory'sini kullanacak şekilde oluşturulduysa Dockerfile Path `Dockerfile`, Docker Context `.` olmalıdır.

## GitHub Pages arayüzü
`public/index.html` API çağrısını `https://apk-olustur.onrender.com` adresine gönderir. Render servisi CORS için `*.github.io` kaynaklarına izin verir.

## Gereksinimler
Docker image içinde Node 20, JDK 17, Android command-line tools, platform 34 ve build-tools 34 kurulmaktadır. İlk Docker build büyük ve uzun sürebilir.

## Güvenlik
Bu MVP dosya yüklemelerini derleme sunucusunda işler. Sadece güvendiğiniz HTML/ZIP dosyalarını yükleyin. Üretim ortamında auth, rate limit, dosya tarama ve job temizleme eklenmelidir.


## Bu sürümde düzeltme
- `npx cap` yerine proje içindeki `node_modules/.bin/cap` doğrudan çağrılır. Böylece Render'daki `npm error could not determine executable to run` hatası önlenir.
- Render servisi Docker runtime ile çalışmalıdır; Dockerfile Java 17 ve Android SDK'yı kurar.
- Render Root Directory: boş (repo kökü `programlar`)
- Dockerfile Path: `./apkolustur/Dockerfile`
- Docker Context: `./apkolustur`
- Health Check Path: `/api/health`
