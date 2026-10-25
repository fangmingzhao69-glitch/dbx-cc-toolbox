# CC 工具箱自托管插件仓库

DBX 官方商店要求插件包由受信任的仓库密钥签名。这里用 Ed25519 自建一个仓库：
签名密钥和 catalog 都由本仓库脚本生成，DBX 里添加仓库 + 信任公钥后即可像商店一样安装/更新。

## 目录产物

```
repo/
├── build-repo.mjs                 生成签名包 + catalog
├── serve.cjs                      本地静态服务器
├── start-repo.cmd                 双击启动（端口 5210）
├── keys/<keyId>.json              仓库私钥（请勿外传）
└── dist/
    ├── catalog/index.json         DBX 读取的插件目录
    └── plugins/com.cctoolbox.json/0.1.0/*.signed.dbxp
```

## 使用步骤

1. 双击 `start-repo.cmd`（保持窗口开着），启动地址：
   `http://127.0.0.1:5210/catalog/index.json`
2. 打开 DBX → 插件中心 → **设置** → **插件仓库**，填写并点「添加仓库」：
   - 仓库 ID：`cctoolbox.local`
   - 仓库名称：`CC 工具箱自托管仓库`
   - Catalog URL：`http://127.0.0.1:5210/catalog/index.json`
3. 同一页下方「仓库信任设置」新增一条：
   - Key ID：`cctoolbox-local-2026`
   - Public Key：`/c3/+1FI+BT/jfMp05ZFxjoYuCRbhFKAiv+0d7Br4Qo=`
   - 保存
4. 刷新插件商店，搜索「CC 工具箱」→ 安装。
5. 顶部工具栏插件按钮或命令面板打开「CC 工具箱 · JSON 解析」。

> 仓库服务只在安装/更新时需要；安装完成后可以关闭窗口，插件仍可正常使用。
> 端口被占用时：`node build-repo.mjs --port 5211`，并用 5211 启动、更新 Catalog URL。

## 重新生成签名包

修改插件后：

```bash
cd ..
dbx-plugin package .          # 先出未签名候选包 dist/*.dbxp
cd repo
node build-repo.mjs           # 重新签名并更新 catalog（沿用同一个密钥）
```

公钥不变，已添加过的信任配置无需重填；版本升级时同步修改 `build-repo.mjs` 里的 `version` 常量。

## 密钥说明

- 私钥保存在 `repo/keys/cctoolbox-local-2026.json`，请勿提交到公开仓库。
- 想重新生成密钥：删除该文件后重新运行 `build-repo.mjs`，然后在 DBX 里删掉旧信任项、添加新的 Key ID / Public Key。
