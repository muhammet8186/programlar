HIZLI SATIS - MUTFAK BOLUM AYARLARI GUNCELLEMESI

Bu paket, mevcut Firebase senkronizasyon duzeltmesini ve mutfak ekranini korur.
Bildirim sesi secimi, ses onizleme ve ses dosyasi yukleme kontrolleri ana mutfak ekranindan kaldirilarak "Bolum ayarlari" penceresine tasinmistir.

YAPILANLAR:
- Bildirim sesi secimi artik Bolum ayarlari penceresindedir.
- Ses onizleme dugmesi Bolum ayarlari penceresindedir.
- Ses dosyasi yukleme alani Bolum ayarlari penceresindedir.
- Mutfak ana ekranindaki ayri ses ayarlari paneli kaldirilmistir.
- Bolum bazli ses ac/kapat ve otomatik fis tercihleri mevcut davranisiyla korunmustur.
- Bolum ayarlari acildiginda kayitli ses tercihi ve yuklenen dosya adi alana yuklenir.
- Yuklenen ses dosyasi mevcut uygulama davranisiyla bu tarayicinin yerel depolamasinda saklanir; otomatik olarak diger cihazlara aktarilmaz. Dosya boyutu siniri 650 KB'dir.
- Firebase veri yukleme akisinda daha once acik kalan dis try blogu icin hata yakalama eklendi; beklenmeyen yukleme hatasi konsola acik sekilde yazilir.
- Service Worker onbellegi v17 olarak yukseltildi.

KURULUM:
1. Mevcut GitHub projesinin yedegini alin.
2. ZIP icindeki dosyalari dogrudan /programlar/hizlisat/ klasorune yukleyin.
3. index.html, sw.js, manifest.webmanifest ve app-icon-192.png dosyalarini guncelleyin.
4. GitHub Pages dagitiminin tamamlanmasini bekleyin.
5. Chrome'da Ctrl+Shift+R yapin. Gerekirse DevTools > Application > Service Workers bolumunden eski Service Worker'i kaldirip sayfayi yenileyin.

TEST:
- Mutfak ekraninda artik ses secimi/yukleme paneli gorunmemeli.
- Bolum ayarlari dugmesine basildiginda bildirim sesi secimi, Dinle ve Ses dosyasi yukle kontrolleri gorunmeli.
- Ses secimi degistirilip pencere kapatildiktan sonra tekrar acildiginda secim korunmali.
- Ses dosyasi yuklendikten sonra yuklenen dosyanin adi gorunmeli ve Dinle ile onizlenebilmelidir.
- Yeni ayarlar gercek cihaz ve tarayicida denenmelidir. ZIP kontrolu ve JavaScript sozdizimi testi, Firebase canli baglantisini veya sesin tum cihazlarda calismasini tek basina garanti etmez.
