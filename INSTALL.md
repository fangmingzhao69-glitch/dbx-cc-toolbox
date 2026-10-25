# 给其他人安装（换一台电脑）

本插件仓库托管在 GitHub Pages，**对方不需要 GitHub 账号、不需要 token、也不需要本地服务**，只要对方的 DBX 能访问 GitHub Pages 即可。

## 步骤

1. 打开 DBX → **插件中心** → **设置** → **插件仓库**
2. 添加仓库：
   - 仓库 ID：`cctoolbox.local`
   - 仓库名称：`CC 工具箱自托管仓库`
   - Catalog URL：`https://fangmingzhao69-glitch.github.io/dbx-cc-toolbox/catalog/index.json`
3. 同一页「仓库信任设置」新增一条（**必须加，否则会报 untrusted key**）：
   - Key ID：`cctoolbox-local-2026`
   - Public Key：`/c3/+1FI+BT/jfMp05ZFxjoYuCRbhFKAiv+0d7Br4Qo=`
4. 刷新插件商店 → 搜索「CC 工具箱」→ **安装**
5. 顶部工具栏插件按钮，或命令面板搜索「CC 工具箱 · JSON 解析」打开

## 注意事项

- 仓库 ID 必须是 `cctoolbox.local`，和 catalog 里的一致，否则 DBX 会报 repository id 不匹配。
- 公钥必须一行粘贴完整（区分大小写，末尾有 `=`）。
- 更新插件：DBX 插件中心刷新后，在插件商店点更新即可。
- 需要能访问 `fangmingzhao69-glitch.github.io`。如果对方在内网/无法访问 GitHub，可选：
  - 把本仓库 `repo/` 目录拷给对方，用 `repo\start-repo.cmd` 本地起服务（需要 Node.js），Catalog URL 改成 `http://127.0.0.1:5210/catalog/index.json`（需先在本地用 `--base-url` 重新生成 catalog）；
  - 或把 `repo/dist` 放到对方可访问的内网 HTTPS 静态服务器，并用 `node build-repo.mjs --base-url <那个地址>` 重新生成 catalog 后发布。
- 官方商店上架合并后（PR #350），其他人也可以直接在官方插件商店搜索安装，无需添加仓库和公钥。
