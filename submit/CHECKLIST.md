# 提交到 DBX 官方插件商店（t8y2/dbx-store）

官方文档：https://dbxio.com/cn/docs/plugin-development

## 你需要先有

1. 一个**公开** GitHub 仓库（用来放本插件源码），例如 `https://github.com/<你的账号>/dbx-cc-toolbox`
2. 一个 publisher ID（本仓库用 `cctoolbox`，可改，但 manifest 的 `publisher` 必须一致）
3. 许可证（本目录已放 Apache-2.0）

## 第 1 步：把 `<你的账号>` 替换成真实 GitHub 账号

- `submit/candidates/com.cctoolbox.jsongrid.jsongrid` 里的 `fangmingzhao69-glitch`
- `.dbx-store.json` 里的 `source` / `homepage`
- 本文件与 `submit/PR_BODY.md` 里的链接

## 第 2 步：发布源码 + 候选 Release

```bash
# 推送到 GitHub 后，打 tag 并创建 Release
git tag v0.1.0
git push origin v0.1.0
```

Release 发布后，仓库里的 `.github/workflows/plugin-release.yml` 会自动构建并上传：

- `com.cctoolbox.jsongrid-0.1.0-universal.dbxp`（未签名候选包）
- `com.cctoolbox.jsongrid-0.1.0-universal.artifact.json`
- `release-candidates.json`

（也可以本地 `dbx-plugin package .` 后手动上传 `dist/*` 到 Release。）

## 第 3 步：核对候选包的 SHA-256 和大小

```bash
Get-FileHash dist/com.cctoolbox.jsongrid-0.1.0-universal.dbxp -Algorithm SHA256
(Get-Item dist/com.cctoolbox.jsongrid-0.1.0-universal.dbxp).Length
```

必须与 `submit/candidates/com.cctoolbox.jsongrid` 里的 `sha256` / `size` 一致（当前为
`aa1bccc4…c3e7` / 41129）。字节变化就必须递增版本重新发布，已发布资产不可覆盖。

## 第 4 步：向 t8y2/dbx-store 提交 PR

Fork https://github.com/t8y2/dbx-store ，在 `main` 上开一个 PR，只添加两个文件：

- `publishers/cctoolbox.json` ← 复制 `submit/publishers/cctoolbox.json`
- `candidates/com.cctoolbox.jsongrid` ← 复制 `submit/candidates/com.cctoolbox.jsongrid`

PR 描述使用 `submit/PR_BODY.md` 的内容。**不要**手工编辑 `plugins/` 和 `catalog/`，也不要提交
`.dbxp` 二进制、私钥或源码副本。

## 第 5 步：等待审核与签名

- CI 会先保持红色并显示 `open candidate(s) awaiting DBX Store signing`，这是正常的；
- 维护者审核源码/Manifest/权限/哈希后，运行受保护的 **Sign plugin PR candidates** 工作流；
- 签名后工作流把最终 `plugins/com.cctoolbox.jsongrid.json` 和 `catalog/index.json` 写回该 PR；
- CI 变绿后维护者合并，插件即出现在官方插件商店（签名由 DBX Store 完成，你不需要也不应该持有官方私钥）。

## 第 6 步（可选）：登记自动更新

向 dbx-store 提一个 PR，在 `automation/plugin-sources.json` 的 `plugins` 数组里加：

```json
{ "repository": "<你的账号>/dbx-cc-toolbox", "metadataPath": ".dbx-store.json", "autoUpdate": true }
```

之后每次发布新 Release，商店会自动创建候选 PR，你只需维护版本号与 `.dbx-store.json`。

## 更新版本

1. 修改 `manifest.json` 的 `version`；
2. 重新 `dbx-plugin package .`，发布新 Tag/Release（旧资产不覆盖）；
3. 新版本只需再提交 `candidates/com.cctoolbox.jsongrid`（含新版本号与哈希）。
