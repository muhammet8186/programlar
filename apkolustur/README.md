# Kendi APK Oluşturucumuz (MVP)

## Render kurulumu
Bu klasör GitHub deposunda `apkolustur` adıyla yer alıyorsa Render ayarları:
- Root Directory: `apkolustur`
- Build Command: `npm install`
- Start Command: `npm start`

Eğer `package.json` doğrudan depo kökündeyse Root Directory boş bırakılır; Start Command yine `npm start` olur.

`start.js`, `server/index.js` giriş dosyasını olası klasörlerde arar ve bulunamazsa denediği yolları loga yazar.

## Önemli APK derleme notu
Bu Node.js web servisi arayüzü sunar. APK oluşturma endpoint'i Capacitor ve Gradle çalıştırır; bunun için sunucuda Java JDK, Android SDK (platform-tools/build-tools/platform) ve unzip kurulu olmalıdır. Render'ın standart Node runtime'ında Android SDK hazır değildir. Bu nedenle web servisinin açılması, APK derlemesinin otomatik olarak çalışacağı anlamına gelmez. Güvenilir APK derlemesi için Android araçlarını içeren Docker ortamı veya GitHub Actions derleme iş akışı gerekir.
