# PMR Tactical Pro — Üç Haberleşme Altyapılı Teslim Paketi

Bu arşiv, PMR Tactical Pro uygulamasının mevcut HTML dosyasını ve üç haberleşme seçeneği için gerekli sunucu/kurulum dosyalarını içerir.

## Uygulamadaki seçenekler

1. **PeerJS — Varsayılan:** Mevcut PeerJS oda/ses ve veri bağlantısı akışı korunur.
2. **LiveKit Cloud:** LiveKit Cloud medya hizmeti kullanılır. Bu paketteki token API, API Key/Secret değerlerini sunucu tarafında tutup kısa ömürlü katılım tokenı üretir.
3. **Janus — ZimaOS:** ZimaOS üzerinde Janus AudioBridge kullanılır. HTML ayarlarında yerel Wi-Fi ve internet WebSocket adresleri, oda numarası ve PIN ayrı ayrı yapılandırılabilir.

## Klasörler

- `app/index.html` — üç altyapı seçeneği bulunan PMR Tactical Pro HTML uygulaması.
- `servers/janus-zimaos/` — Janus 1.4.2 Docker Compose, AudioBridge oda yapılandırması ve Türkçe kurulum rehberi.
- `servers/livekit-cloud-token-api/` — LiveKit Cloud için token API kaynak kodu ve örnek ortam ayarları.

## Önemli teknik kapsam

- PeerJS varsayılan seçenektir.
- LiveKit Cloud için Cloud projesi, API Key/Secret ve token API sunucusu gerekir. API Secret HTML/APK içine konmaz.
- Janus seçeneği AudioBridge ses bağlantısı, uzak ses ve PTT mute/unmute akışını içerir. Janus modunda sohbet, SOS, yönetici kick/mute ve rol senkronizasyonu için Janus TextRoom/control-channel entegrasyonu ayrıca gerekir.
- Janus örneği varsayılan `1234` oda ve `pmr1234` PIN ile gelir. JCFG dosyası ve uygulama ayarındaki PIN aynı olmalıdır.
- Janus internet erişimi için WSS/TLS, UDP medya portları ve NAT/public IP ayarları gerekir. Bu ilk paket internete açık güvenli üretim kurulumu değildir.
- Paket sözdizimi ve arşiv bütünlüğü kontrol edilmiştir; ZimaOS üzerinde gerçek sesli görüşme testi yapılmamıştır.

## Kurulum sırası

1. `servers/janus-zimaos/README-TR.md` rehberine göre Janus'u ZimaOS'ta yerel ağda kurun.
2. LiveKit Cloud projesi açıp `servers/livekit-cloud-token-api/README-TR.md` rehberini uygulayın.
3. `app/index.html` dosyasını HTTPS üzerinden yayınlayın.
4. Ayarlar bölümünden kullanılacak altyapıyı seçip sunucu profillerini kaydedin.
5. Önce iki cihazla aynı Wi-Fi ağında ses/PTT testi yapın; ardından güvenli internet erişimini yapılandırın.

Gerçek API anahtarları, secret değerleri ve kişisel parolalar bu ZIP'e eklenmemiştir.

Janus web istemcisi, Meetecho'nun `janus.js` dosyasını ve WebRTC adapter kitaplığını CDN üzerinden yükler; ilk Janus bağlantısında cihazın internet erişimi olmalıdır. İlgili resmî API açıklaması: https://janus.conf.meetecho.com/docs/JS.html
