# CC 工具箱 0.2.6

适用于 Windows x64。本版增加两组本地文本处理功能。

- 「编码转换」新增 Escape 编解码，兼容 JavaScript Escape 和 UnEscape 的 `%XX` 与 `%uXXXX` 写法。结果可复制，也可移回输入区继续转换。
- 「XML 数据解析」新增本地文件导入、压缩和复制 XML。格式化支持 2、3、4 个空格或 Tab。文件导入支持 UTF-8、UTF-16 和有相应声明的 GB 系列编码。
- XML 格式化与压缩保留混合文本、相邻节点间的行内空格、CDATA 和 `xml:space="preserve"`。遇到无法读取或解析的文件时，界面会给出错误。

参考功能来自 [站长工具 Escape](https://tool.chinaz.com/Tools/escape.aspx) 和 [菜鸟工具 XML 格式化](https://www.jyshare.com/front-end/710/)。操作在 DBX 插件内完成。

在 DBX 的插件仓库设置中刷新 `cctoolbox.local`，再到已安装插件更新。继续使用原仓库信任配置。
