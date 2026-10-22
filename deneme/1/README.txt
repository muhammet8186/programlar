RESTORAN POS - MODERN + QR MENÜ DEMO

Dosyalar:
- index.html: işletme yönetim ekranı
- customer.html: müşteri için telefona uyumlu dijital menü ve sepet
- styles.css: modern, responsive tasarım
- app.js: satış, ürün, masa, mutfak, rapor ve yerel kayıt mantığı
- customer.js: müşteri menüsü ve QR sipariş demo akışı

Çalıştırma:
1. ZIP dosyasını bir klasöre çıkarın.
2. Bilgisayarda VS Code + Live Server gibi bir yerel web sunucusuyla index.html dosyasını açın.
3. Masa Yönetimi bölümünde bir masanın “Müşteri QR kodu” düğmesine basın.
4. QR önizlemesinden müşteri menüsünü açabilir, örnek ürün seçip sipariş akışını test edebilirsiniz.

Özellikler:
- Örnek ürünlerle hızlı satış
- Nakit, kredi kartı ve veresiye ödeme kayıtları
- Masa yönetimi ve masaya özel müşteri QR bağlantısı
- Telefona uyumlu dijital menü, kategori filtreleme, arama ve sepet
- Müşteri sipariş notu alanı
- Mutfak sipariş durumları; QR sipariş notu mutfak kartında gösterilir
- Ürün maliyeti, stok ve düşük stok uyarıları
- Satış özeti, tahmini brüt kâr ve CSV raporu
- JSON yedekleme ve geri yükleme
- Yerel tarayıcı depolamasına otomatik kayıt

ÖNEMLİ SINIRLAMALAR:
- Bu bir başlangıç/demo sürümüdür; örnek ürünler içerir.
- QR menüsü ve sipariş gönderme akışı prototiptir. Bu sürümde müşteri ve kasa ekranlarının ayrı cihazlarda canlı eşitlemesi etkin değildir.
- Gerçek masalarda kullanmak için uygulama HTTPS destekleyen bir web adresinde yayınlanmalı ve Firebase Realtime Database veya benzeri bir arka uç üzerinden güvenli, kimliği doğrulanmış canlı eşitleme kurulmalıdır. Veritabanını herkese açık yazma izniyle açmayın.
- QR kodunun ürettiği bağlantı, uygulamanın yayınlandığı adresi temel alır. file:// bağlantıları başka telefonlarda çalışmaz.
- Firebase ekranındaki alanlar yapılandırma notlarını kaydeder; canlı Firebase senkronizasyonu bu sürümde uygulanmamıştır.
- Çok kullanıcılı kullanım, canlı veriler, yazıcı/fatura ve güvenlik kuralları için ayrıca geliştirme ve test gerekir.
- Satış tamamlandığında stok düşer; mutfağa gönderilen sipariş ayrı bir işlem olarak kaydedilir.
- Kâr hesabı ürünlerde girilen maliyet bilgilerine dayanır; vergi, kira, personel ve diğer giderleri içermez.
- Bu program resmi e-fatura/POS terminali entegrasyonu değildir.
- Gerçek işletme verilerine geçmeden önce JSON yedeği alın ve test siparişleri yapın.
