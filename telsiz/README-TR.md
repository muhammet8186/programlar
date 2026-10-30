# PMR Tactical Pro – LiveKit SFU sunucu bileşeni

Bu klasör, HTML uygulamasının çok kullanıcılı grup sesini LiveKit SFU üzerinden taşıması için gereken token API örneğidir. HTML tek başına SFU sunucusu çalıştıramaz.

## 1) LiveKit sunucusu

İki seçenek vardır:
- LiveKit Cloud hesabı açıp proje URL/API Key/API Secret değerlerini almak.
- Kendi Linux sunucunuza LiveKit Server kurmak ve TLS/WSS erişimi sağlamak.

LiveKit bağlantı URL'si `wss://...` biçiminde olmalıdır. Mikrofon erişimi için web uygulaması da HTTPS üzerinden yayınlanmalıdır (localhost geliştirme istisnası).

## 2) Token API'yi kurma

Node.js 20 veya üstü kurulu sunucuda:

```bash
npm install
cp .env.example .env
```

`.env` içindeki `LIVEKIT_URL`, `LIVEKIT_API_KEY` ve `LIVEKIT_API_SECRET` değerlerini doldurun. API secret kesinlikle HTML dosyasına yazılmamalıdır.

```bash
npm start
```

API varsayılan olarak `http://SUNUCU:3000/api/livekit-token` adresinde token üretir. Gerçek kullanımda bu servisi HTTPS arkasında yayınlayın ve `ALLOWED_ORIGINS` değerini uygulamanızın alan adıyla sınırlandırın.

## 3) HTML uygulamasını ayarlama

1. `Telsiz+Mikrofon Programı.html` dosyasını HTTPS destekleyen bir web alanına yükleyin.
2. Uygulamayı açın, Menü > Ayar sekmesine girin.
3. “LiveKit token API HTTPS adresi” alanına `https://API-ALANADINIZ/api/livekit-token` yazın.
4. “LiveKit adresini kaydet” düğmesine basın.
5. Yönetici odayı kursun; misafirler aynı oda adı ve mevcut oda parolasıyla katılsın.

## Önemli güvenlik ve mevcut sınırlar

- Bu paket token API örneğidir; sizin adınıza bir bulut hesabı veya sunucu oluşturmaz, internete dağıtım yapmaz.
- `ROOM_PASSWORD` ayarlanırsa tüm odalarda aynı ortak parola aranır. Oda başına farklı parolalar için mevcut uygulamanın oda doğrulamasını sunucu tarafına taşımak gerekir.
- `ROOM_PASSWORD` boş bırakılırsa token endpoint'i kimlik doğrulamasızdır. Üretimde bu haliyle internete açmayın; oturum doğrulaması, oda üyeliği kontrolü, hız sınırı ve CORS alan adı kısıtlaması ekleyin.
- Bu geçişte PeerJS, mevcut oda katılımı/kullanıcı listesi/yazılı mesaj gibi kontrol işlevleri için tutulur; ses akışı LiveKit'e taşınır. PeerJS'nin eski ses çağrıları kapatılmıştır.
- Çoklu ses akışları her katılımcı için ayrı audio öğesi olarak oynatılır. Telefonların hoparlöründe akustik yankı oluşabilir; kulaklık önerilir.
- Gerçek cihaz ve ağ testleri yapılmadan belirli bir eşzamanlı kullanıcı sayısı garanti edilemez.
