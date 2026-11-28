HIZLI SATIS - KONSOL HATALARI ICIN DUZELTME PAKETI

Bu ZIP'in icindeki dosyalar dogrudan uygulama klasorune konulacak sekildedir. ZIP'te ekstra ust klasor yoktur.

Yapilanlar:
- Eski arayuz yordamcilarinin secilenSekme degiskenine yaptigi global referanslar icin uyumluluk degiskeni eklendi.
- Sekme degistiginde global aktif sekme de guncellenir.
- pos_active_period_v1 icin onceki pakette bulunan eski duz metin donem kimligi okuma uyumlulugu korunmustur.
- PWA simgesi onbellek kabuguna eklendi; manifestte 192x192 ikon tanimlandi.
- Service Worker onbellegi v14'e yukseltildi.
- Mobil web app meta etiketi eklendi.

KURULUM:
1. GitHub reposunda /programlar/hizlisat/ klasorunu acin.
2. ZIP'i acin ve icindeki index.html, sw.js, manifest.webmanifest ve app-icon-192.png dosyalarini dogrudan hizlisat klasorune yukleyin.
3. index.html dosyasini eski dosyanin uzerine yazin.
4. GitHub Pages dagitiminin tamamlanmasini bekleyin.
5. Chrome'da Ctrl+Shift+R yapin. Gerekirse DevTools > Application > Service Workers bolumunden eski service worker'i unregister edip sayfayi yenileyin.

NOT: Tailwind CDN uyarisi kritik JavaScript hatasi degildir; uygulama gorunum kutuphanesinin CDN'den yuklendigini bildirir.
Firebase canli yazma/okuma, izin kurallari ve farkli cihaz testi kullanicinin Firebase ortami uzerinde ayrica yapilmalidir.
