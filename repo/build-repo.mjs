// 构建"自托管插件仓库"：用 Ed25519 仓库密钥签名插件包，生成 DBX 可用的 catalog。
// 用法：node build-repo.mjs [--port 5210]
import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'manifest.json'), 'utf8'));
const pluginId = manifest.id;
const version = manifest.version;
const hasBackend = Boolean(manifest.entrypoints && manifest.entrypoints.backend);
const target = hasBackend ? 'windows-x64' : 'universal';
const releaseBaseIndex = process.argv.indexOf('--release-url-base');
const releaseBase = releaseBaseIndex >= 0 ? process.argv[releaseBaseIndex + 1].replace(/\/$/, '') : '';
const unsignedPath = path.join(pluginRoot, 'dist', pluginId + '-' + version + '-' + target + '.dbxp');

const portIndex = process.argv.indexOf('--port');
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : Number(process.env.CC_REPO_PORT || 5210);
const baseUrlIndex = process.argv.indexOf('--base-url');
const baseUrl = baseUrlIndex >= 0
  ? process.argv[baseUrlIndex + 1].replace(/\/$/, '')
  : (process.env.CC_REPO_BASE_URL ? process.env.CC_REPO_BASE_URL.replace(/\/$/, '') : 'http://127.0.0.1:' + port);

const KEY_ID = 'cctoolbox-local-2026';
const keyDir = path.join(here, 'keys');
const keyPath = path.join(keyDir, KEY_ID + '.json');
fs.mkdirSync(keyDir, { recursive: true });

let keys;
if (fs.existsSync(keyPath)) {
  keys = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  console.log('使用已有签名密钥：' + KEY_ID);
} else {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  keys = {
    keyId: KEY_ID,
    publicKeyBase64: spki.subarray(spki.length - 32).toString('base64'),
    privateKeyPkcs8Base64: pkcs8.toString('base64'),
  };
  fs.writeFileSync(keyPath, JSON.stringify(keys, null, 2) + '\n');
  console.log('已生成新的签名密钥：' + KEY_ID);
}

const privateKey = crypto.createPrivateKey({ key: Buffer.from(keys.privateKeyPkcs8Base64, 'base64'), format: 'der', type: 'pkcs8' });
const publicKey = crypto.createPublicKey({ key: Buffer.from(keys.publicKeyBase64, 'base64').length === 32
  ? Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(keys.publicKeyBase64, 'base64')])
  : Buffer.from(keys.publicKeyBase64, 'base64'), format: 'der', type: 'spki' });

// 1. 收集要打包的文件：原生插件直接读源码目录（manifest/assets/ui/bin），纯前端读未签名 dbxp
const files = new Map();
const collectDirectory = (relative) => {
  const full = path.join(pluginRoot, relative);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isFile()) { files.set(relative, fs.readFileSync(full)); return; }
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const child = relative + '/' + entry.name;
    if (entry.isDirectory()) collectDirectory(child);
    else if (entry.isFile()) files.set(child, fs.readFileSync(path.join(pluginRoot, child)));
  }
};
if (hasBackend) {
  collectDirectory('manifest.json');
  collectDirectory('assets');
  collectDirectory('ui');
  collectDirectory('bin');
  if (!files.size) throw new Error('没有收集到插件文件');
} else {
  const unsigned = new AdmZip(unsignedPath);
  for (const entry of unsigned.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    if (name === 'checksums.json' || name === 'signature.json') continue;
    files.set(name, entry.getData());
  }
}

// 2. 计算 checksums.json 并签名
const sortedNames = [...files.keys()].sort();
const checksumMap = {};
for (const name of sortedNames) checksumMap[name] = crypto.createHash('sha256').update(files.get(name)).digest('hex');
const checksumsBytes = Buffer.from(JSON.stringify({ algorithm: 'sha256', files: checksumMap }, null, 2));
const signatureBytes = Buffer.from(JSON.stringify({
  algorithm: 'ed25519',
  key_id: keys.keyId,
  signature: crypto.sign(null, checksumsBytes, privateKey).toString('base64'),
}, null, 2));

// 3. 重新打包为已签名 .dbxp
const signedZip = new AdmZip();
for (const name of sortedNames) signedZip.addFile(name, files.get(name));
signedZip.addFile('checksums.json', checksumsBytes);
signedZip.addFile('signature.json', signatureBytes);

const fileName = pluginId + '-' + version + '-' + target + '.signed.dbxp';
const outDir = path.join(here, 'dist', 'plugins', pluginId, version);
fs.mkdirSync(outDir, { recursive: true });
const signedPath = path.join(outDir, fileName);
signedZip.writeZip(signedPath);
const signedBytes = fs.readFileSync(signedPath);
const sha256 = crypto.createHash('sha256').update(signedBytes).digest('hex');
const size = signedBytes.length;

// 4. 自检签名（用原始 32 字节公钥验证）
const rawPub = Buffer.from(keys.publicKeyBase64, 'base64');
const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawPub]);
const verifyKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
if (!crypto.verify(null, checksumsBytes, verifyKey, crypto.sign(null, checksumsBytes, privateKey))) {
  throw new Error('签名自检失败');
}
console.log('已签名并自检通过：' + signedPath);

// 5. 写 catalog
const catalog = {
  $schema: 'https://dbx.local/schemas/plugin-marketplace-v1.json',
  catalogVersion: 1,
  repository: {
    id: 'cctoolbox.local',
    name: 'CC 工具箱自托管仓库',
    homepage: baseUrl + '/catalog/index.json',
  },
  generatedAt: new Date().toISOString(),
  plugins: [
    {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      publisher: manifest.publisher,
      icon: baseUrl + '/plugins/' + pluginId + '/' + version + '/plugin.svg',
      tags: ['json', 'grid', 'workbench', 'cctoolbox'],
      permissions: manifest.permissions,
      source: manifest.source,
      homepage: manifest.homepage,
      latestVersion: version,
      versions: [
        {
          version,
          releasedAt: new Date().toISOString(),
          releaseNotes: '首个版本：JSON 文本 + 表格视图、嵌套展开、高级筛选、CSV 导出、淡绿/深色主题。',
          artifacts: [
            {
              target,
              url: releaseBase ? releaseBase + '/' + fileName : baseUrl + '/plugins/' + pluginId + '/' + version + '/' + fileName,
              sha256,
              signingKeyId: keys.keyId,
              size,
            },
          ],
        },
      ],
      localizations: {
        'zh-CN': { name: manifest.name, description: manifest.description },
      },
    },
  ],
};
const catalogDir = path.join(here, 'dist', 'catalog');
fs.mkdirSync(catalogDir, { recursive: true });
fs.writeFileSync(path.join(catalogDir, 'index.json'), JSON.stringify(catalog, null, 2) + '\n');

// 图标放到包旁边，catalog 里直接引用
fs.copyFileSync(path.join(pluginRoot, 'assets', 'plugin.svg'), path.join(outDir, 'plugin.svg'));

fs.writeFileSync(path.join(here, 'dist', 'repo-info.json'), JSON.stringify({
  catalogUrl: baseUrl + '/catalog/index.json',
  repositoryId: 'cctoolbox.local',
  repositoryName: 'CC 工具箱自托管仓库',
  keyId: keys.keyId,
  publicKey: keys.publicKeyBase64,
  pluginFile: signedPath,
  sha256,
  size,
}, null, 2) + '\n');

console.log('\n===== 仓库信息（填写到 DBX 插件中心）=====');
console.log('Catalog URL : ' + baseUrl + '/catalog/index.json');
console.log('仓库 ID     : cctoolbox.local');
console.log('仓库名称    : CC 工具箱自托管仓库');
console.log('Key ID      : ' + keys.keyId);
console.log('Public Key  : ' + keys.publicKeyBase64);
console.log('包文件      : ' + signedPath);
console.log('SHA-256     : ' + sha256);