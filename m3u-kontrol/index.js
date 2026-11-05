var host = '0.0.0.0';
var port = process.env.PORT || 8080;

var cors_proxy = require('cors-anywhere');
cors_proxy.createServer({
    requireHeader: [], // Ekstra başlık zorunluluğunu kaldırır
    removeHeaders: ['cookie', 'cookie2']
}).listen(port, host, function() {
    console.log('CORS Proxy aktif: ' + host + ':' + port);
});
