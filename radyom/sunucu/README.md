# STREAM PULSE PRO – AAC/AAC+ yayın dönüştürücü

Bu küçük servis, SHOUTcast/Icecast kaynaklarını FFmpeg ile canlı MP3 akışına dönüştürür. Tarayıcıya dosya indirme başlığı göndermez; `audio/mpeg` içerik türüyle sürekli yayın verir.

## Render üzerinde kurulum

1. Bu klasörü ayrı bir GitHub deposuna yükleyin.
2. Render → New → Web Service → depoyu seçin.
3. Runtime: Node
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Environment Variables:
   - `ALLOWED_HOSTS` = `46.20.3.201,stream.rcast.net`
7. Deploy tamamlanınca servis adresini alın. Örnek: `https://stream-pulse-proxy.onrender.com`

## Sağlık kontrolü

`https://SERVIS-ADRESI/health` adresi `{"ok":true,...}` döndürmelidir.

## Yayın adresi

Örnek kaynak:
`http://46.20.3.201:80/`

Proxy uç noktası:
`https://SERVIS-ADRESI/stream?url=http%3A%2F%2F46.20.3.201%3A80%2F`

## Başka radyo sunucuları

Yeni istasyonların alan adlarını `ALLOWED_HOSTS` değişkenine virgülle ekleyin. IP tabanlı yayınlarda IP adresini ekleyin. Güvenlik nedeniyle izin listesi dışındaki sunuculara proxy erişimi kapalıdır.

## Notlar

- Bu servis tarayıcı uyumluluğu için AAC/AAC+ akışını MP3'e dönüştürür.
- Sürekli yayın dönüştürme CPU kullanır. Render planının sürekli bağlantıları ve gerekli kaynakları desteklediğinden emin olun.
- Kaynak yayın kapalıysa, kimlik doğrulama istiyorsa veya sağlayıcı bağlantıyı engelliyorsa dönüştürme yapılamaz.
- Bu servis yalnızca kullanma hakkınız olan yayınlar için kullanılmalıdır.
