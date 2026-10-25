// 极简静态服务器，用于把 repo/dist 作为自托管插件仓库提供出去。
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, 'dist');
const port = Number(process.argv[2] || 5210);
const types = { '.json': 'application/json; charset=utf-8', '.dbxp': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '') p = '/catalog/index.json';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('CC 插件仓库已启动: http://127.0.0.1:' + port + '/catalog/index.json'));
