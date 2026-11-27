HIZLI SATIŞ - INDEXEDDB ANA KAYIT SİSTEMİ

Başlatma:
- index.html dosyasını Chrome veya Edge ile açın.
- Çevrimdışı/PWA desteği için klasörü HTTPS destekli bir web sunucusunda yayınlayın.

Kayıt sistemi:
- Uygulama verileri IndexedDB içinde HizliSatisDB veritabanının appState deposunda tutulur.
- İlk açılışta mevcut pos_* LocalStorage kayıtları IndexedDB'ye aktarılır ve aktarım okunarak doğrulanır.
- Eski LocalStorage kayıtları aktarım sırasında silinmez.
- Uygulama, mevcut kod yapısıyla uyumluluk için localStorage API'sini kullanmaya devam eder; pos_* anahtarları bellek önbelleği üzerinden okunur ve IndexedDB'ye yazılır.
- IndexedDB başlatılamazsa uygulama veri kaybını önlemek için eski LocalStorage yöntemiyle açılmayı dener.

Önemli:
- İlk açılışta aktarımın tamamlanması için sayfayı kapatmayın.
- Tarayıcı/site verilerini temizlemek IndexedDB kayıtlarını da silebilir. Düzenli Excel yedeği alın.
- Firebase bulut kayıtları bu değişiklikle silinmez veya taşınmaz.
