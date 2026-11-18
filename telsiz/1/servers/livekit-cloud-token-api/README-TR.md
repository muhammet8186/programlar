# LiveKit Cloud Token API — ZimaOS

Bu servis LiveKit medya sunucusu değildir. Medya LiveKit Cloud üzerinde kalır; bu küçük API, LiveKit Cloud API Key/Secret kullanarak uygulamaya kısa ömürlü katılım tokenı üretir. Secret hiçbir zaman HTML veya APK içine konulmamalıdır.

## ZimaOS kurulumu
1. Bu klasörü ZimaOS cihazına kopyalayın.
2. `.env.example` dosyasını `.env` olarak kopyalayın.
3. LiveKit Cloud projenizin `wss://...` adresini, API Key ve API Secret değerlerini girin.
4. `APP_ORIGIN` değerini uygulamanın gerçek HTTPS adresiyle, `ROOM_PASSWORD` değerini uygulamanın oda parolasıyla eşleştirin.
5. ZimaOS Custom Install ekranında bu klasördeki `docker-compose.yml` içeriğini kullanın; `.env` dosyasının Compose tarafından okunabildiğinden emin olun.
6. Servisi HTTPS arkasında yayınlayın. Düz HTTP'yi internetten açmayın.

Kontrol: `https://TOKEN_API_ADRESINIZ/health`
Token endpoint: `POST https://TOKEN_API_ADRESINIZ/token`
Gövde: `{ "roomName": "pmr-001", "identity": "kullanici", "roomPassword": "..." }`

## Güvenlik
- `.env` dosyasını paylaşmayın veya ZIP'e gerçek anahtar/parola koymayın.
- Port 3001'i doğrudan internete açmak yerine HTTPS ters proxy veya güvenli tünel kullanın.
- Bu örnek tek ortak oda parolası kullanır; üretim kullanımı öncesinde kullanıcı kimlik doğrulaması, denetim kayıtları ve daha sıkı rate limit eklenmelidir.
