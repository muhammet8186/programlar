# Online Radyo - Ücretsiz Render Kayıt Sunucusu

Bu servis radyo akışını sunucuda FFmpeg ile MP3 olarak kaydeder. Durdurulduğunda MP3 dosyasını tarayıcıya gönderir; uygulama dosyayı cihazın IndexedDB kayıtlarına kaydeder.

## GitHub'a ekleme

Bu klasörü `muhammet8186/programlar` deposunun köküne `online-radyo-kayit-sunucusu` adıyla yükleyin.

## Render kurulumu

1. Render Dashboard > New > Web Service.
2. `muhammet8186/programlar` deposunu seçin.
3. Root Directory: `online-radyo-kayit-sunucusu`.
4. Runtime: Docker.
5. Plan: Free.
6. Environment Variables bölümüne `RECORD_API_KEY` ekleyin. En az 32 karakterlik rastgele bir anahtar kullanın; bu anahtarı kimseyle paylaşmayın.
7. Deploy edin. Servis adresiniz `https://...onrender.com` şeklinde olur.

## Online Radyo ayarı

Uygulama > Ayarlar > Sunucu Üzerinden Kayıt bölümüne Render servis adresini ve aynı API anahtarını girip kaydedin. Ardından radyoyu çalarken kayıt düğmesini kullanın.

## Ücretsiz plan uyarısı

Render Free kalıcı disk sunmaz. Bu nedenle sunucudaki geçici MP3, indirme tamamlanınca silinir. Uygulama dosyayı cihazdaki Radyo Kayıtları alanına kaydeder. Kayıt sırasında uygulamayı açık tutun; servis uykuya geçmesin diye uygulama yaklaşık 25 saniyede bir durum kontrolü gönderir. Uzun kayıtlar ücretsiz plandaki kaynak ve bağlantı sınırlarına takılabilir.

## Güvenlik

API anahtarı olmadan kayıt başlatılamaz. Yalnızca herkese açık HTTP/HTTPS akışları kabul edilir; yerel/özel ağ adresleri engellenir. Kayıt servisini yalnızca yetkili olduğunuz yayınlar için kullanın.
