# CC 工具箱自托管插件仓库（GitHub Pages）

已发布到 GitHub Pages，DBX 里直接添加下面的地址即可，**不需要本地服务器**。

## 在 DBX 中安装

1. 打开 DBX → 插件中心 → **设置** → **插件仓库**：
   - 仓库 ID：`cctoolbox.local`
   - 仓库名称：`CC 工具箱自托管仓库`
   - Catalog URL：`https://fangmingzhao69-glitch.github.io/dbx-cc-toolbox/catalog/index.json`
   - 点「添加仓库」
2. 同一页下方「仓库信任设置」新增：
   - Key ID：`cctoolbox-local-2026`
   - Public Key：`/c3/+1FI+BT/jfMp05ZFxjoYuCRbhFKAiv+0d7Br4Qo=`
   - 保存
3. 刷新插件商店，搜索「CC 工具箱」→ 安装。

## 仓库内容

GitHub Pages 分支 `gh-pages` 由 `repo/build-repo.mjs` 生成：

```bash
cd repo
node build-repo.mjs --base-url https://fangmingzhao69-glitch.github.io/dbx-cc-toolbox
# 然后把 repo/dist 内容推送到 gh-pages 分支
```

- `catalog/index.json`：DBX 读取的插件目录
- `plugins/com.cctoolbox.jsongrid/0.1.0/*.signed.dbxp`：已签名插件包
- 签名私钥保存在 `repo/keys/`（已 gitignore，**不要提交**）

## 本地调试（可选）

```bash
node serve.cjs 5210
# Catalog URL 改为 http://127.0.0.1:5210/catalog/index.json（需要先用 --base-url 指向本地重建）
```

## 更新插件版本

1. 修改 `manifest.json` 的 `version`；
2. `dbx-plugin package .` 生成未签名候选包；
3. `cd repo && node build-repo.mjs --base-url https://fangmingzhao69-glitch.github.io/dbx-cc-toolbox` 重新签名；
4. 把 `repo/dist` 推送到 `gh-pages` 分支（可 `git push -f`）；
5. DBX 插件中心刷新即可看到更新。
