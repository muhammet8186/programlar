# apkolustur — GitHub Actions APK builder

## ÖNEMLİ GitHub kuralı
GitHub Actions workflow dosyaları mutlaka deponun kökündeki `.github/workflows/` altında olmalıdır. Bu nedenle workflow, `apkolustur/` içinde kalırsa çalışmaz. ZIP'te `github-root-workflow/` klasörü ayrıca verildi; içindeki `.github` klasörünü `programlar` deposunun köküne taşı/yükle.

## Kendi HTML uygulaman
1. `apkolustur/webapp/` içine kendi HTML'ini `index.html` adıyla koy.
2. CSS, JS, görseller ve diğer bağlı dosyaları da `webapp/` içine, klasör yapılarını koruyarak koy.
3. GitHub repo köküne `github-root-workflow/.github/workflows/build-apk.yml` dosyasını `.github/workflows/build-apk.yml` olarak ekle.
4. GitHub'da Actions → **HTML to Android APK** → **Run workflow**.
5. Uygulama adı ve benzersiz paket kimliği gir (`com.sirket.uygulama`).
6. Başarılı run sayfasının Artifacts bölümünden `android-debug-apk` ZIP'ini indir.
7. ZIP'i aç, `app-debug.apk` dosyasını telefona yükle.

## Not
Bu workflow debug APK üretir. Play Store için release imzası/AAB ayrıca hazırlanır. GitHub Actions kullanım limitleri hesabına göre değişir.
