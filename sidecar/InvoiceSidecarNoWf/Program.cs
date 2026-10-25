using System.Drawing;
using System.Drawing.Printing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Docnet.Core;
using Docnet.Core.Models;
using System.Reflection;
using System.Text.Json;

const string PluginId = "com.cctoolbox.jsongrid";
var version = Assembly.GetExecutingAssembly().GetName().Version ?? new Version(0, 1, 19);
var versionText = version.Major + "." + version.Minor + "." + Math.Max(0, version.Build);
var stdout = Console.Out;

while (true)
{
    var line = Console.In.ReadLine();
    if (line is null) break;
    if (string.IsNullOrWhiteSpace(line)) continue;
    JsonDocument document;
    try { document = JsonDocument.Parse(line); }
    catch (JsonException) { continue; }
    using (document)
    {
        var root = document.RootElement;
        var id = root.TryGetProperty("id", out var idElement) ? idElement.Clone() : default;
        var method = root.TryGetProperty("method", out var methodElement) ? methodElement.GetString() ?? "" : "";
        var parameters = root.TryGetProperty("params", out var paramsElement) ? paramsElement : default;
        try
        {
            object? result = method switch
            {
                "plugin/initialize" => new
                {
                    protocolVersion = 1,
                    capabilities = new[] { "invoice/printers", "invoice/print", "invoice/version" },
                    plugin = new { id = PluginId, version = versionText },
                },
                "invoice/version" => new { version = versionText },
                "invoice/printers" => ListPrinters(),
                "invoice/print" => Print(parameters),
                "invoice/preview" => Preview(parameters),
                _ => throw new InvalidOperationException("Unknown method: " + method),
            };
            WriteResponse(stdout, id, result, null);
        }
        catch (Exception error)
        {
            WriteResponse(stdout, id, null, new { code = -32000, message = error.Message });
        }
    }
}

static void WriteResponse(TextWriter writer, JsonElement? id, object? result, object? error)
{
    var payload = new Dictionary<string, object?> { ["jsonrpc"] = "2.0" };
    if (id is not null) payload["id"] = id;
    if (error is not null) payload["error"] = error;
    else payload["result"] = result;
    writer.WriteLine(JsonSerializer.Serialize(payload));
    writer.Flush();
}

static object ListPrinters()
{
    var printers = new List<object>();
    string defaultName = "";
    try { defaultName = new PrinterSettings().PrinterName; } catch { }
    foreach (var name in PrinterSettings.InstalledPrinters.Cast<string>())
    {
        printers.Add(new { name, isDefault = string.Equals(name, defaultName, StringComparison.OrdinalIgnoreCase) });
    }
    return new { printers };
}

static object Print(JsonElement parameters)
{
    var images = LoadImages(parameters);
    try
    {
        if (images.Count == 0) throw new InvalidOperationException("没有可打印的图片数据");

        int layout = 1;
        if (parameters.TryGetProperty("layout", out var layoutElement) && layoutElement.TryGetInt32(out var layoutValue))
            layout = layoutValue is 2 or 4 ? layoutValue : 1;
        int copies = 1;
        if (parameters.TryGetProperty("copies", out var copiesElement) && copiesElement.TryGetInt32(out var copiesValue))
            copies = Math.Clamp(copiesValue, 1, 99);
        double offsetX = 0, offsetY = 0;
        if (parameters.TryGetProperty("offsetXmm", out var offsetXElement) && offsetXElement.TryGetDouble(out var ox)) offsetX = ox;
        if (parameters.TryGetProperty("offsetYmm", out var offsetYElement) && offsetYElement.TryGetDouble(out var oy)) offsetY = oy;
        string printer = "";
        if (parameters.TryGetProperty("printer", out var printerElement)) printer = printerElement.GetString() ?? "";
        string printFile = "";
        if (parameters.TryGetProperty("printFile", out var printFileElement)) printFile = printFileElement.GetString() ?? "";
        double paperWidth = 0, paperHeight = 0;
        if (parameters.TryGetProperty("paperWidthMm", out var pw) && pw.TryGetDouble(out var width)) paperWidth = width;
        if (parameters.TryGetProperty("paperHeightMm", out var ph) && ph.TryGetDouble(out var height)) paperHeight = height;

        using var document = new PrintDocument();
        if (!string.IsNullOrWhiteSpace(printer)) document.PrinterSettings.PrinterName = printer;
        if (string.IsNullOrWhiteSpace(printer) && string.IsNullOrWhiteSpace(printFile))
            document.PrinterSettings.PrinterName = new PrinterSettings().PrinterName;
        if (!document.PrinterSettings.IsValid) throw new InvalidOperationException("打印机不可用：" + document.PrinterSettings.PrinterName);
        document.PrinterSettings.Copies = (short)copies;
        if (!string.IsNullOrWhiteSpace(printFile))
        {
            document.PrinterSettings.PrinterName = string.IsNullOrWhiteSpace(printer) ? "Microsoft Print to PDF" : printer;
            document.PrinterSettings.PrintToFile = true;
            document.PrinterSettings.PrintFileName = printFile;
        }
        document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
        document.OriginAtMargins = true;
        if (paperWidth > 0 && paperHeight > 0)
        {
            document.DefaultPageSettings.PaperSize = new PaperSize("CCCustom",
                (int)Math.Round(paperWidth / 25.4 * 100), (int)Math.Round(paperHeight / 25.4 * 100));
        }
        int pageIndex = 0;
        int columns = layout == 4 ? 2 : 1;
        int rows = layout == 4 ? 2 : layout;
        int total = images.Count;
        document.PrintPage += (_, args) =>
        {
            var graphics = args.Graphics!;
            graphics.PageUnit = GraphicsUnit.Display;
            float pageWidth = args.PageBounds.Width;
            float pageHeight = args.PageBounds.Height;
            float cellWidth = pageWidth / columns;
            float cellHeight = pageHeight / rows;
            float offsetXPixels = (float)(offsetX / 25.4 * graphics.DpiX);
            float offsetYPixels = (float)(offsetY / 25.4 * graphics.DpiY);
            for (int slot = 0; slot < layout; slot++)
            {
                int index = pageIndex * layout + slot;
                if (index >= total) break;
                var image = images[index];
                int column = slot % columns;
                int row = slot / columns;
                float availableWidth = cellWidth - 8;
                float availableHeight = cellHeight - 8;
                float scale = Math.Min(availableWidth / image.Width, availableHeight / image.Height);
                float drawWidth = image.Width * scale;
                float drawHeight = image.Height * scale;
                float x = column * cellWidth + (cellWidth - drawWidth) / 2 + offsetXPixels;
                float y = row * cellHeight + (cellHeight - drawHeight) / 2 + offsetYPixels;
                graphics.DrawImage(image, x, y, drawWidth, drawHeight);
            }
            pageIndex++;
            args.HasMorePages = pageIndex * layout < total;
        };
        document.Print();
        int pages = (int)Math.Ceiling(total / (double)layout);
        return new { success = true, pages, images = total, layout, printer = document.PrinterSettings.PrinterName, printFile };
    }
    finally
    {
        foreach (var image in images) image.Dispose();
    }
}
static object Preview(JsonElement parameters)
{
    var images = LoadImages(parameters);
    try
    {
        if (images.Count == 0) throw new InvalidOperationException("没有可预览的图片数据");
        int layout = 1;
        if (parameters.TryGetProperty("layout", out var layoutElement) && layoutElement.TryGetInt32(out var layoutValue))
            layout = layoutValue is 2 or 4 ? layoutValue : 1;
        double paperWidth = 0, paperHeight = 0;
        if (parameters.TryGetProperty("paperWidthMm", out var pw) && pw.TryGetDouble(out var width)) paperWidth = width;
        if (parameters.TryGetProperty("paperHeightMm", out var ph) && ph.TryGetDouble(out var height)) paperHeight = height;

        using var document = new PrintDocument();
        var controller = new BitmapPrintController();
        document.PrintController = controller;
        document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
        document.OriginAtMargins = true;
        if (paperWidth > 0 && paperHeight > 0)
        {
            document.DefaultPageSettings.PaperSize = new PaperSize("CCCustom",
                (int)Math.Round(paperWidth / 25.4 * 100), (int)Math.Round(paperHeight / 25.4 * 100));
        }
        int pageIndex = 0;
        int columns = layout == 4 ? 2 : 1;
        int rows = layout == 4 ? 2 : layout;
        document.PrintPage += (_, args) =>
        {
            var graphics = args.Graphics!;
            graphics.PageUnit = GraphicsUnit.Display;
            float pageWidth = args.PageBounds.Width;
            float pageHeight = args.PageBounds.Height;
            float cellWidth = pageWidth / columns;
            float cellHeight = pageHeight / rows;
            for (int slot = 0; slot < layout; slot++)
            {
                int index = pageIndex * layout + slot;
                if (index >= images.Count) break;
                var image = images[index];
                int column = slot % columns;
                int row = slot / columns;
                float scale = Math.Min((cellWidth - 8) / image.Width, (cellHeight - 8) / image.Height);
                float drawWidth = image.Width * scale;
                float drawHeight = image.Height * scale;
                graphics.DrawImage(image,
                    column * cellWidth + (cellWidth - drawWidth) / 2,
                    row * cellHeight + (cellHeight - drawHeight) / 2,
                    drawWidth, drawHeight);
            }
            pageIndex++;
            args.HasMorePages = pageIndex * layout < images.Count;
        };
        document.Print();
        var pages = new List<string>();
        foreach (var bitmap in controller.Pages)
        {
            using var ms = new MemoryStream();
            bitmap.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
            pages.Add(Convert.ToBase64String(ms.ToArray()));
            bitmap.Dispose();
        }
        return new { success = true, pages };
    }
    finally
    {
        foreach (var image in images) image.Dispose();
    }
}

static List<Image> LoadImages(JsonElement parameters)
{
    var images = new List<Image>();
    if (parameters.ValueKind != JsonValueKind.Object || !parameters.TryGetProperty("images", out var imageArray)) return images;
    foreach (var imageElement in imageArray.EnumerateArray())
    {
        var value = imageElement.GetString();
        if (string.IsNullOrWhiteSpace(value)) continue;
        var mime = "";
        var base64 = value;
        if (value.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var comma = value.IndexOf(',');
            var header = value[5..(comma < 0 ? value.Length : comma)];
            mime = header.Split(';')[0];
            if (comma < 0) continue;
            base64 = value[(comma + 1)..];
        }
        var bytes = Convert.FromBase64String(base64);
        var isPdf = mime.Contains("pdf", StringComparison.OrdinalIgnoreCase) ||
                    (bytes.Length > 3 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F');
        if (isPdf) images.AddRange(RenderPdf(bytes));
        else
        {
            using var stream = new MemoryStream(bytes);
            images.Add(Image.FromStream(stream));
        }
    }
    return images;
}

static List<Image> RenderPdf(byte[] pdfBytes)
{
    var result = new List<Image>();
    using var library = DocLib.Instance;
    using var document = library.GetDocReader(pdfBytes, new PageDimensions(1240, 1754));
    var pageCount = document.GetPageCount();
    for (var index = 0; index < pageCount; index++)
    {
        using var page = document.GetPageReader(index);
        var width = page.GetPageWidth();
        var height = page.GetPageHeight();
        var raw = page.GetImage();
        var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        var data = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(raw, 0, data.Scan0, raw.Length);
        bitmap.UnlockBits(data);
        result.Add(bitmap);
    }
    return result;
}

sealed class BitmapPrintController : PrintController
{
    public List<Bitmap> Pages { get; } = new();
    private Bitmap? _bitmap;
    private Graphics? _graphics;

    public override Graphics OnStartPage(PrintDocument document, PrintPageEventArgs args)
    {
        var bounds = args.PageBounds;
        _bitmap = new Bitmap(Math.Max(1, bounds.Width), Math.Max(1, bounds.Height));
        _graphics = Graphics.FromImage(_bitmap);
        _graphics.Clear(Color.White);
        return _graphics;
    }

    public override void OnEndPage(PrintDocument document, PrintPageEventArgs args)
    {
        _graphics?.Dispose();
        _graphics = null;
        if (_bitmap is not null) Pages.Add(_bitmap);
        _bitmap = null;
    }
}
