# Kendi APK Oluşturucumuz — MVP

Bu proje, HTML dosyasını yükleyip Android **debug APK** üretmeye yönelik ilk sürümdür.

## Gereksinimler
- Node.js 20+
- Java JDK 17
- Android SDK (platform-tools, build-tools, Android platform)
- `ANDROID_HOME` veya `ANDROID_SDK_ROOT` değişkeni
- Linux üzerinde `unzip`, `zip`, `git` araçları

> APK derleme işlemi ilk çalıştırmada Capacitor ve Android Gradle bağımlılıklarını indirir.
> Bu MVP, güvenlik nedeniyle herkese açık internete doğrudan açılmamalıdır. Önce LAN içinde test edin.
> Yüklenen dosyaları izole bir kullanıcı/container altında derlemek üretim için önerilir.

## Kurulum
```bash
npm install
npm start
```
Ardından `http://SUNUCU_IP:3000` adresini açın.

## Kullanım
1. HTML dosyası (`.html`) veya web projesi ZIP'i yükleyin.
2. Uygulama adını girin.
3. Paket kimliğini (ör. `com.ornek.hizlisatis`) girin.
4. **APK Oluştur** düğmesine basın.
5. Derleme başarılı olursa debug APK indirme bağlantısı görünür.

## Bilinen sınırlar
- Bu sürüm yalnızca **debug APK** üretir; Play Store için imzalı release/AAB henüz yok.
- Uygulama simgesi, splash screen, izinler ve imzalama sonraki sürüme eklenecek.
- Derleme sunucusunda Android SDK/JDK kurulu değilse APK üretimi çalışmaz.
- ZIP içindeki `index.html` kök dizinde bulunmalı (veya tek bir üst klasör içinde olmalı).
