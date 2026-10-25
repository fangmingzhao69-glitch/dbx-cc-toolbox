## Plugin submission

- Plugin ID: com.cctoolbox.jsongrid
- Version: 0.1.0
- Publisher ID: cctoolbox

## Source repository and tag

https://github.com/fangmingzhao69-glitch/dbx-cc-toolbox/tree/v0.1.0

## Capabilities and user workflow

提供一个 DBX Workbench「CC 工具箱 · JSON 解析」：左侧 JSON 文本编辑/格式化/校验，右侧把 JSON 渲染成键值表或对象数组表格；嵌套对象/数组用 `[+] [n]` 展开（带条数统计，展开后整行跨列、内部滚动）；支持高级筛选（JS + lodash）、CSV 导出、顶部工具栏/命令面板入口。纯前端，无连接类型，无原生后端。

## Permissions, data access, and network access

- 权限：仅 `host.storage`（记住编辑器内容/主题偏好，可选）。
- 不读取数据库、连接、凭据；不发起网络请求；不写文件系统。
- 用户数据只在沙箱页面内处理，不上传。

## Native sidecar behavior

None（frontend-only universal 包，无原生可执行文件、无子进程、无监听端口）。

## License

Apache-2.0

## Homepage or support URL

https://github.com/fangmingzhao69-glitch/dbx-cc-toolbox

## Confirmation

- [x] The candidate packages are unsigned and match the disclosed source tag.
- [x] I have not included private keys, tokens, credentials, or proprietary data.
- [x] The candidates are listed in `candidates/com.cctoolbox.jsongrid.json`; `plugins/` and `catalog/` were not edited manually.

