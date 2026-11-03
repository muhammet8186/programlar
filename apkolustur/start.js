const fs = require('fs');
const path = require('path');

// Render Root Directory apkolustur olarak veya depo kökü olarak ayarlanmış olsa da
// sunucu giriş dosyasını olası dizinlerden bulur.
const candidates = [
  path.join(__dirname, 'server', 'index.js'),
  path.join(__dirname, 'apkolustur', 'server', 'index.js'),
  path.join(process.cwd(), 'server', 'index.js'),
  path.join(process.cwd(), 'apkolustur', 'server', 'index.js'),
  path.join(process.cwd(), '..', 'apkolustur', 'server', 'index.js')
].map(p => path.resolve(p));
const entry = candidates.find(p => fs.existsSync(p));
if (!entry) {
  console.error('server/index.js bulunamadı. Denenen yollar:');
  candidates.forEach(p => console.error(' - ' + p));
  console.error('Mevcut dizin:', process.cwd());
  console.error('Dizin içeriği:', fs.readdirSync(process.cwd()).join(', '));
  process.exit(1);
}
console.log('Sunucu giriş dosyası bulundu:', entry);
require(entry);
