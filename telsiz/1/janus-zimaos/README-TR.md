# PMR Tactical Pro — Janus / ZimaOS kurulumu

Bu klasör, PMR Tactical Pro'nun üçüncü haberleşme seçeneği olan **Janus AudioBridge** sunucusunu ZimaOS üzerinde Docker ile çalıştırmak içindir.

## Paket içeriği

- `docker-compose.yml` — Janus 1.4.2 konteyneri.
- `conf.d/janus.plugin.audiobridge.jcfg` — PMR için örnek AudioBridge odası (1234).
- `PORT-BILGILERI.txt` — port ve oda bilgileri.

Kullanılan imaj: `ghcr.io/texttechnologylab/janus-gateway:1.4.2`. Bu, Janus upstream projesini paketleyen topluluk imajıdır; Meetecho tarafından yayımlanan resmî bir Docker imajı değildir. İmaj dokümantasyonu: https://texttechnologylab.github.io/Janus-Gateway/

## ZimaOS web arayüzünden kurulum

1. ZIP'i bilgisayarınızda açın.
2. ZimaOS dosya yöneticisinde uygulama/proje için bir klasör oluşturun (ör. `pmr-janus`).
3. Bu klasörün içine `docker-compose.yml` dosyasını ve `conf.d` klasörünü kopyalayın. `conf.d` içinde `janus.plugin.audiobridge.jcfg` bulunmalıdır.
4. ZimaOS App Store / Docker bölümünden **Custom Install / Özel Uygulama Yükle** ekranını açın.
5. `docker-compose.yml` içeriğini Compose alanına yapıştırın ve uygulamayı kurun. Göreli `./conf.d` bağlamasının çalışması için Compose projesinin klasör bağlamı `pmr-janus` olmalıdır.
6. `pmr-janus` konteynerinin çalıştığını kontrol edin.

ZimaOS sürümüne göre menü adları değişebilir. Eğer özel kurulum ekranı yerel klasör bağlamasını desteklemiyorsa, Compose'u ZimaOS'un proje/uygulama klasöründen deploy edin; yalnızca YAML metnini yapıştırmak yapılandırma dosyasını konteynere taşımaz.

## İlk LAN testi

ZimaOS yerel IP adresinizi kullanın:

- Janus HTTP kontrol: `http://ZIMAOS_IP:8088/janus/info`
- Janus WebSocket: `ws://ZIMAOS_IP:8188`
- WebRTC medya: varsayılan `20000-40000/UDP`

`/janus/info` JSON döndürürse Janus HTTP API yanıt veriyor demektir. Bu, iki telefon arasında sesin çalıştığını tek başına kanıtlamaz.

## PMR uygulama ayarları

PMR Tactical Pro > Ayarlar > Haberleşme Altyapısı bölümünde:

- Altyapı: `Janus (ZimaOS)`
- Yerel Wi-Fi WebSocket: `ws://ZIMAOS_IP:8188` (uygulama güvenli bağlamdaysa WSS/TLS kullanın)
- İnternet WebSocket: `wss://janus.SIZIN-DOMAININIZ`
- AudioBridge oda numarası: `1234`
- AudioBridge oda PIN'i: `pmr1234`

Oda PIN'i, `conf.d/janus.plugin.audiobridge.jcfg` içindeki `pin` ile aynı olmalıdır. PIN'i değiştirirseniz iki yerde de değiştirin. Uygulamadaki oda/kanal adı ekranda görünen ad olarak kalır; Janus tarafında ses odasını sayısal AudioBridge oda numarası belirler.

Yeni oda eklemek için JCFG dosyasına `room-1235: { ... }` gibi yeni bir oda bloğu ekleyin, sonra uygulamadaki oda numarasını aynı değere ayarlayın. Yapılandırma değişikliğinden sonra Janus konteynerini yeniden başlatın.

## İnternet erişimi ve güvenlik

Bu paket ilk olarak yerel ağ testi için hazırlanmıştır. İnternete açmadan önce:

- `8188/TCP` için TLS sonlandıran ters proxy kurup uygulamada `wss://` kullanın.
- Janus WebRTC medya için `20000-40000/UDP` aralığını ve public IP/NAT ICE ayarlarını yapılandırın.
- Router ve güvenlik duvarında yalnızca gerekli portları açın.
- `8088/TCP` HTTP kontrol API'sini internete açmayın.
- Oda PIN'ini varsayılan değerden değiştirin ve JCFG içindeki `secret` değerini güçlü, gizli bir değerle değiştirin.
- CGNAT varsa standart port yönlendirme çalışmayabilir; public IPv4 veya uygun bir relay/VPS çözümü gerekir.

HTTPS ile yayınlanan bir web uygulaması, güvensiz `ws://` adresine tarayıcı tarafından engellenebilir. Yerel ve internet profillerinde güvenilir sertifikalı WSS kullanmak en sağlam çözümdür.

## Uygulama kapsamı

Bu sürüm Janus AudioBridge üzerinden sesli odaya katılma, uzak ses alma ve PTT sırasında sunucuya mute/unmute gönderme akışını içerir. Janus modunda mevcut PeerJS/LiveKit veri kanalı özellikleri (sohbet, SOS, yönetici kick/mute ve rol senkronizasyonu) Janus TextRoom entegrasyonu yapılana kadar taşınmaz. Bunlar PeerJS ve LiveKit modlarında mevcut akışlarını kullanır.

Janus sunucusu ve uygulama kodu burada gerçek ZimaOS/Android cihazlarında çalıştırılmadı; kurulumdan sonra iki cihazla LAN testi yapılmalıdır.

## Kaynaklar

- Janus upstream: https://github.com/meetecho/janus-gateway
- AudioBridge API: https://janus.conf.meetecho.com/docs/audiobridge
- Janus JavaScript API: https://janus.conf.meetecho.com/docs/JS.html
- Kullanılan imaj: https://github.com/texttechnologylab/Janus-Gateway
