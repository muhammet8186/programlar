HIZLI SATIŞ - INDEXEDDB DESTEKLİ SÜRÜM

Kurulum:
- ZIP içeriğini HTTPS destekleyen bir web sunucusuna yükleyin veya localhost üzerinden çalıştırın.
- file:// üzerinden açıldığında Service Worker ve çevrimdışı uygulama kabuğu çalışmayabilir.
- Programı ilk kez açarken mevcut tarayıcı verilerinin aktarılması için birkaç saniye bekleyin.

Veri koruma:
- İlk açılışta eski localStorage kayıtları IndexedDB'ye kopyalanır; eski kayıtlar silinmez.
- IndexedDB'de bulunan kayıtlar sonraki açılışlarda öncelikli kabul edilir.
- Ürün, kategori, müşteri, satış geçmişi, kasa, kullanıcı, ayar ve dönem verileri yerel IndexedDB deposuna yazılır.
- Firebase eşitlemesi mevcut ayarlara göre çalışmaya devam eder.
- Tarayıcı/site verileri kullanıcı tarafından temizlenirse IndexedDB de silinebilir. Düzenli Excel/JSON yedeği alın.

Not:
- Bu sürümün JavaScript sözdizimi kontrol edilmiştir. Gerçek cihaz, tarayıcı kotası, Firebase projesi ve yazıcı ile uçtan uca test yapılmamıştır.
