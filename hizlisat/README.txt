HIZLI SATIS - MUTFAK BOLUM AYARLARI / GUVENLILIK GUNCELLEMESI

Bu paket mevcut uygulamanin yapisi korunarak duzenlenmistir.

Yapilanlar:
- IndexedDB yazma kuyrugu hata sonrasi calismaya devam edecek sekilde duzenlendi.
- IndexedDB flush() artik yazma hatalarini basari gibi gizlemiyor; hata bilgisini cagirana iletiyor.
- Kalici depolama hatalarinda konsol kaydi ve kullaniciya uyari eklendi.
- Mutfak bolum tercihlerinin (kategori ozel ses/yazdirma ayarlari), genel ses ve otomatik fis seceneklerinin Firebase ile senkronizasyonu eklendi.
- Mutfak ayarlari Firebase kok dugumunde mutfak_bolum_ayarlar_v1 yolunda saklanir.
- Ses dosyasi ve ses tonu gibi cihaza ozel medya tercihleri Firebase'e gonderilmez.
- Service Worker onbellek surumu v12'ye yukseltildi; Firebase veritabani ve kimlik dogrulama istekleri onbellek disinda tutulur.

Kurulum:
1. Mevcut uygulama dosyalarini yedekleyin.
2. index.html, sw.js ve manifest.webmanifest dosyalarini sunucudaki uygulama dosyalariyla degistirin.
3. Tarayicida uygulamayi yenileyin. Gerekirse PWA'yi kapatip yeniden acin.
4. Firebase ayarlarinin etkin oldugunu ve veritabani guvenlik kurallarinin okuma/yazmaya izin verdigini kontrol edin.

ONEMLI:
- Firebase gercek ortam baglantisi bu paket uzerinde test edilemez; Firebase proje ayarlari ve guvenlik kurallari kullanici ortaminda dogrulanmalidir.
- Ilk Firebase senkronizasyonunda bulutta mutfak ayari yoksa mevcut cihaz ayarlari buluta ilk deger olarak yazilir. Bulutta ayar varsa diger cihazlara aktarilir.
- Ses dosyasi/ton tercihi cihazda kalir.
- Yazdirma davranisi tarayici ve yazici izinlerine baglidir.
