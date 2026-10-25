## Plugin submission

- Plugin ID: com.cctoolbox.jsongrid
- Version: 0.2.1
- Publisher ID: cctoolbox
- Target: windows-x64（含原生侧车，仅 Windows）

## Source repository and tag

https://github.com/fangmingzhao69-glitch/dbx-cc-toolbox/tree/v0.2.1

## Capabilities and user workflow

在 DBX 工作台中提供综合工具箱（侧边栏切换）：JSON 解析（表格/嵌套展开/多页签/定位高亮）、JSON 结构比对、CSV 预览与内容比对、临时建表（Excel/CSV/JSON → 建表 INSERT SQL）、快速建表（INSERT 解析）、数据验证（只读 SQL + 离线规则校验）、在线绘图、发票批量打印（导入 PDF/图片发票，1/2/4 版式，套打偏移，选择打印机/预览/打印）。

## Permissions, data access, and network access

- `host.storage`：保存页签、主题、分割比例等本地偏好。
- `host.connections:read`：读取连接列表（名称/方言/状态），用于首页概览与数据验证。
- `host.data:read`：在用户授权连接上执行**只读** SQL；首次按连接弹窗授权，可随时撤销。
- 无网络请求；不读取凭据/连接串；侧车仅本机打印。

## Native sidecar behavior

Windows x64 原生侧车 `bin/win-x64/cc-invoice-sidecar.exe`（C# 单文件约 75MB，随包含 pdfium.dll）：

- stdio JSONL 协议，实现 `invoice/printers` / `invoice/preview` / `invoice/print`；
- 枚举打印机、PDF(PDFium)/图片渲染、A4/发票纸、1/2/4 版式、mm 套打偏移、份数、预览、发送打印；
- 不监听端口、不联网、不主动写文件（PrintToFile 由调用方指定）；以当前用户权限运行；
- 仅 Windows 提供（插件 target = windows-x64）。

## License

Apache-2.0

## Homepage or support URL

https://github.com/fangmingzhao69-glitch/dbx-cc-toolbox

## Confirmation

- [x] The candidate packages are unsigned and match the disclosed source tag.
- [x] I have not included private keys, tokens, credentials, or proprietary data.
- [x] The candidates are listed in `candidates/com.cctoolbox.jsongrid.json`; `plugins/` and `catalog/` were not edited manually.
