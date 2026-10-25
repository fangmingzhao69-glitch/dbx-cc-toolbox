// 原生插件打包（C# 侧车）：生成未签名 .dbxp 候选包 + artifact.json，供 DBX 官方商店 CI 使用
import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const target = process.env.DBX_PLUGIN_TARGET || 'windows-x64';
const version = manifest.version;
const pluginId = manifest.id;

const files = new Map();
function collect(relative) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isFile()) { files.set(relative.replace(/\\/g, '/'), fs.readFileSync(full)); return; }
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const child = path.posix.join(relative.replace(/\\/g, '/'), entry.name);
    if (entry.isDirectory()) collect(child);
    else if (entry.isFile()) files.set(child, fs.readFileSync(path.join(root, child)));
  }
}
collect('manifest.json');
collect('assets');
collect('ui');
collect('bin');
if (!files.size) throw new Error('没有收集到插件文件');

const sorted = [...files.keys()].sort();
const checksumMap = {};
for (const name of sorted) checksumMap[name] = crypto.createHash('sha256').update(files.get(name)).digest('hex');

const zip = new AdmZip();
for (const name of sorted) zip.addFile(name, files.get(name));
zip.addFile('checksums.json', Buffer.from(JSON.stringify({ algorithm: 'sha256', files: checksumMap }, null, 2)));

const outputDir = path.join(root, 'dist');
fs.mkdirSync(outputDir, { recursive: true });
const fileName = pluginId + '-' + version + '-' + target + '.dbxp';
const outputPath = path.join(outputDir, fileName);
zip.writeZip(outputPath);
const bytes = fs.readFileSync(outputPath);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

fs.writeFileSync(path.join(outputDir, fileName.replace(/\.dbxp$/, '.artifact.json')), JSON.stringify({
  target,
  url: fileName,
  sha256,
  size: bytes.length,
}, null, 2) + '\n');
console.log('已生成未签名候选包：' + outputPath + '（' + bytes.length + ' bytes，sha256=' + sha256 + '）');
