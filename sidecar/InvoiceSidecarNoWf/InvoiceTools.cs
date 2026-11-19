using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.Runtime.InteropServices;
using System.Text.Json;
using Docnet.Core;
using Docnet.Core.Models;

internal sealed class InvoiceSource
{
    private static readonly object PdfLock = new();
    private readonly byte[] bytes;
    private readonly bool pdf;
    private readonly Guid? frameDimension;
    public int Pages { get; }

    public InvoiceSource(byte[] bytes)
    {
        this.bytes = bytes;
        pdf = bytes.AsSpan().StartsWith("%PDF-"u8);
        if (pdf)
        {
            lock (PdfLock)
            {
                using var reader = DocLib.Instance.GetDocReader(bytes, new PageDimensions(100, 100));
                Pages = reader.GetPageCount();
            }
        }
        else
        {
            using var stream = new MemoryStream(bytes, writable: false);
            using var image = Image.FromStream(stream, false, true);
            CheckImageSize(image.Width, image.Height);
            if (image.FrameDimensionsList.Contains(FrameDimension.Page.Guid))
                frameDimension = FrameDimension.Page.Guid;
            Pages = frameDimension is Guid guid ? image.GetFrameCount(new FrameDimension(guid)) : 1;
        }
        if (Pages is < 1 or > 1000) throw new InvalidOperationException("单个文件必须包含 1 到 1000 页");
    }

    public Bitmap Render(int index, int pixels)
    {
        if (index < 0 || index >= Pages) throw new ArgumentOutOfRangeException(nameof(index), "原稿页码超出范围");
        if (pdf)
        {
            lock (PdfLock)
            {
                using var reader = DocLib.Instance.GetDocReader(bytes, new PageDimensions(pixels, pixels));
                using var page = reader.GetPageReader(index);
                var width = page.GetPageWidth();
                var height = page.GetPageHeight();
                CheckImageSize(width, height);
                var raw = page.GetImage();
                var result = new Bitmap(width, height, PixelFormat.Format32bppArgb);
                try
                {
                    var data = result.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                    try
                    {
                        if (raw.Length != data.Stride * height) throw new InvalidOperationException("PDF 页面像素数据不完整");
                        Marshal.Copy(raw, 0, data.Scan0, raw.Length);
                    }
                    finally { result.UnlockBits(data); }
                    return result;
                }
                catch { result.Dispose(); throw; }
            }
        }

        using var input = new MemoryStream(bytes, writable: false);
        using var image = Image.FromStream(input, false, true);
        if (frameDimension is Guid dimension) image.SelectActiveFrame(new FrameDimension(dimension), index);
        CheckImageSize(image.Width, image.Height);
        var scale = Math.Min(1, (double)pixels / Math.Max(image.Width, image.Height));
        var bitmap = new Bitmap(Math.Max(1, (int)Math.Round(image.Width * scale)), Math.Max(1, (int)Math.Round(image.Height * scale)));
        try
        {
            using var graphics = Graphics.FromImage(bitmap);
            graphics.Clear(Color.White);
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.DrawImage(image, 0, 0, bitmap.Width, bitmap.Height);
            return bitmap;
        }
        catch { bitmap.Dispose(); throw; }
    }

    private static void CheckImageSize(int width, int height)
    {
        if (width <= 0 || height <= 0 || (long)width * height > 40_000_000)
            throw new InvalidOperationException("图片尺寸超过 4000 万像素");
    }
}

internal sealed record InvoicePage(InvoiceSource Source, int Index, int Rotation);

internal static class InvoiceTools
{
    private const int FileLimit = 32 * 1024 * 1024;
    private const int TotalLimit = 128 * 1024 * 1024;
    private const int ChunkLimit = 384 * 1024;
    private const int MaxFiles = 100;
    private const int MaxPages = 1000;
    private static readonly Dictionary<string, Batch> Batches = new();
    private static readonly ConcurrentDictionary<string, InvoiceJob> Jobs = new();
    private static int submittingJobs;

    private sealed class Upload(int length)
    {
        public byte[] Bytes { get; } = new byte[length];
        public int Written { get; set; }
        public InvoiceSource? Source { get; set; }
        public string? Digest { get; set; }
    }

    private sealed class Batch
    {
        public DateTime LastAccess { get; set; } = DateTime.UtcNow;
        public Dictionary<string, Upload> Files { get; } = new();
    }

    public static object? Call(string method, JsonElement args)
    {
        if (method == "invoice/printers") return Printers();
        if (method == "invoice/job/status") return LookupJob(RequiredString(args, "jobId"));
        if (method == "invoice/preview" && args.TryGetProperty("images", out var images)) return LegacyPreview(args, images);
        if (method == "invoice/print" && args.TryGetProperty("images", out var legacyFiles))
            return LegacyPrint(args, LegacyPages(legacyFiles));
        if (method == "invoice/workspace/open")
        {
            foreach (var stale in Batches.Where(pair => DateTime.UtcNow - pair.Value.LastAccess > TimeSpan.FromHours(2)).ToArray())
                Batches.Remove(stale.Key);
            if (Batches.Count >= 4) throw new InvalidOperationException("已有 4 个发票工作区，请关闭不用的工作区");
            var id = Guid.NewGuid().ToString("N");
            Batches.Add(id, new Batch());
            return new { id, chunkBytes = ChunkLimit, fileBytes = FileLimit, totalBytes = TotalLimit, maxFiles = MaxFiles };
        }
        var batchId = RequiredString(args, "workspaceId");
        if (method == "invoice/workspace/close") return new { closed = Batches.Remove(batchId) };
        if (!Batches.TryGetValue(batchId, out var batch)) throw new InvalidOperationException("发票工作区已失效，请重新导入文件");
        batch.LastAccess = DateTime.UtcNow;

        switch (method)
        {
            case "invoice/files/open":
                var length = args.GetProperty("length").GetInt32();
                if (length <= 0 || length > FileLimit) throw new InvalidOperationException("单个发票文件须在 32 MiB 以内且不能为空");
                if (batch.Files.Count >= MaxFiles || batch.Files.Values.Sum(file => (long)file.Bytes.Length) + length > TotalLimit)
                    throw new InvalidOperationException("每个工作区最多 100 个文件，合计 128 MiB");
                var id = Guid.NewGuid().ToString("N");
                batch.Files.Add(id, new Upload(length));
                return new { id };
            case "invoice/files/write":
                var upload = FindFile(batch, args);
                var encoded = RequiredString(args, "data");
                if (encoded.Length > ChunkLimit * 4 / 3 || upload.Source is not null ||
                    args.GetProperty("offset").GetInt32() != upload.Written ||
                    !Convert.TryFromBase64String(encoded, upload.Bytes.AsSpan(upload.Written), out var written) || written == 0)
                    throw new InvalidOperationException("文件分块大小或偏移不正确");
                upload.Written += written;
                return new { written };
            case "invoice/files/finish":
                var completed = FindFile(batch, args);
                if (completed.Written != completed.Bytes.Length) throw new InvalidOperationException("文件尚未传输完整");
                if (completed.Source is null)
                {
                    var digest = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(completed.Bytes));
                    var duplicate = batch.Files.Any(pair => !ReferenceEquals(pair.Value, completed) && pair.Value.Digest == digest);
                    if (duplicate)
                    {
                        batch.Files.Remove(RequiredString(args, "fileId"));
                        return new { duplicate = true, pages = 0 };
                    }
                    completed.Source = new InvoiceSource(completed.Bytes);
                    completed.Digest = digest;
                }
                return new { duplicate = false, pages = completed.Source.Pages };
            case "invoice/files/remove":
                return new { removed = batch.Files.Remove(RequiredString(args, "fileId")) };
            case "invoice/file/preview":
                var source = FindFile(batch, args).Source ?? throw new InvalidOperationException("文件尚未完成导入");
                using (var original = source.Render(args.GetProperty("page").GetInt32() - 1, 1100))
                {
                    var rotation = ReadRotation(args);
                    if (rotation != 0) original.RotateFlip((RotateFlipType)(rotation / 90));
                    return new { png = Png(original), width = original.Width, height = original.Height };
                }
            case "invoice/preview":
                var pages = SelectedPages(batch, args);
                var layout = InvoiceLayout.Read(args.GetProperty("settings"));
                var sheets = SheetCount(pages, layout);
                var sheet = args.GetProperty("sheet").GetInt32();
                if (sheet < 1 || sheet > sheets) throw new InvalidOperationException("排版页码超出范围");
                return new { png = Preview(layout, pages, sheet - 1), sheet, sheets, widthMm = layout.Width, heightMm = layout.Height };
            case "invoice/print":
                return QueuePrint(args.GetProperty("settings"), SelectedPages(batch, args));
            default:
                throw new InvalidOperationException("未知发票操作");
        }
    }

    private static string RequiredString(JsonElement args, string key) =>
        args.GetProperty(key).GetString() ?? throw new ArgumentException("缺少参数 " + key);

    private static Upload FindFile(Batch batch, JsonElement args) =>
        batch.Files.TryGetValue(RequiredString(args, "fileId"), out var upload) ? upload :
            throw new InvalidOperationException("文件已移除或尚未导入");

    private static int ReadRotation(JsonElement settings)
    {
        var rotation = settings.TryGetProperty("rotation", out var value) ? value.GetInt32() : 0;
        return rotation is 0 or 90 or 180 or 270 ? rotation : throw new ArgumentException("旋转必须为 0、90、180 或 270 度");
    }

    private static List<InvoicePage> SelectedPages(Batch batch, JsonElement args)
    {
        var pages = new List<InvoicePage>();
        foreach (var file in args.GetProperty("files").EnumerateArray())
        {
            var source = FindFile(batch, file).Source ?? throw new InvalidOperationException("文件尚未完成导入");
            var rotation = ReadRotation(file);
            var first = file.GetProperty("first").GetInt32();
            var last = file.GetProperty("last").GetInt32();
            if (first < 1 || last < first || last > source.Pages) throw new ArgumentException("打印页码超出文件范围");
            if (pages.Count + last - first + 1 > MaxPages) throw new ArgumentException("每个任务最多处理 1000 张原稿");
            for (var i = first; i <= last; i++) pages.Add(new InvoicePage(source, i - 1, rotation));
        }
        if (pages.Count == 0) throw new ArgumentException("请至少选择一个发票文件");
        return pages;
    }

    private static List<InvoicePage> LegacyPages(JsonElement files)
    {
        var pages = new List<InvoicePage>();
        foreach (var file in files.EnumerateArray())
        {
            var value = file.GetString() ?? "";
            var separator = value.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ? value.IndexOf(',') : -1;
            var source = new InvoiceSource(Convert.FromBase64String(value[(separator + 1)..]));
            if (pages.Count + source.Pages > MaxPages) throw new ArgumentException("每个任务最多处理 1000 张原稿");
            for (var i = 0; i < source.Pages; i++) pages.Add(new InvoicePage(source, i, 0));
        }
        if (pages.Count == 0) throw new ArgumentException("请至少选择一个发票文件");
        return pages;
    }

    private static object LegacyPreview(JsonElement settings, JsonElement images)
    {
        var layout = InvoiceLayout.Read(settings);
        var pages = LegacyPages(images);
        var sheets = SheetCount(pages, layout);
        if (sheets > 20) throw new ArgumentException("请使用新版逐页排版预览");
        return new { success = true, pages = Enumerable.Range(0, sheets).Select(i => Preview(layout, pages, i)).ToArray() };
    }

    private static int SheetCount(IReadOnlyList<InvoicePage> pages, InvoiceLayout layout) =>
        (pages.Count + layout.PerSheet - 1) / layout.PerSheet;

    private static string Preview(InvoiceLayout layout, IReadOnlyList<InvoicePage> pages, int sheet)
    {
        var scale = Math.Min(5, 1400 / Math.Max(layout.Width, layout.Height));
        using var bitmap = new Bitmap((int)Math.Ceiling(layout.Width * scale), (int)Math.Ceiling(layout.Height * scale));
        using var graphics = Graphics.FromImage(bitmap);
        graphics.Clear(Color.White);
        graphics.PageUnit = GraphicsUnit.Pixel;
        graphics.ScaleTransform(scale, scale);
        layout.Draw(graphics, pages, sheet, draftPreview: true);
        return Png(bitmap);
    }

    private static string Png(Bitmap bitmap)
    {
        using var stream = new MemoryStream();
        bitmap.Save(stream, ImageFormat.Png);
        return Convert.ToBase64String(stream.GetBuffer(), 0, checked((int)stream.Length));
    }

    private static object Printers()
    {
        var defaultName = new PrinterSettings().PrinterName;
        var printers = PrinterSettings.InstalledPrinters.Cast<string>()
            .Select(name => new { name, isDefault = string.Equals(name, defaultName, StringComparison.OrdinalIgnoreCase) }).ToArray();
        return new { printers, workspaces = true };
    }

    private static object QueuePrint(JsonElement settings, List<InvoicePage> pages)
    {
        var layout = InvoiceLayout.Read(settings);
        var printer = RequiredString(settings, "printer");
        if (string.IsNullOrWhiteSpace(printer)) throw new ArgumentException("请选择打印机");
        if (Interlocked.CompareExchange(ref submittingJobs, 1, 0) != 0)
            throw new InvalidOperationException("有任务正在提交到打印机，请稍后再试");
        try
        {
            if (Jobs.Values.Count(item => !item.IsTerminal) >= 10)
                throw new InvalidOperationException("已有 10 个打印任务等待队列确认，请稍后再试");
            var job = new InvoiceJob(printer, SheetCount(pages, layout) * layout.Copies);
            foreach (var item in Jobs.Values.Where(item => item.IsTerminal).OrderByDescending(item => item.Created).Skip(49))
                Jobs.TryRemove(item.Id, out _);
            Jobs[job.Id] = job;
            var worker = new Thread(() =>
            {
                try { job.Print(layout, pages); }
                catch (Exception error) { job.Fail(error.Message); }
                finally
                {
                    Interlocked.Exchange(ref submittingJobs, 0);
                    job.StartMonitoring();
                }
            }) { IsBackground = true };
            worker.SetApartmentState(ApartmentState.STA);
            worker.Start();
            return job.Snapshot();
        }
        catch { Interlocked.Exchange(ref submittingJobs, 0); throw; }
    }

    private static object LegacyPrint(JsonElement settings, List<InvoicePage> pages)
    {
        var layout = InvoiceLayout.Read(settings);
        var printer = settings.TryGetProperty("printer", out var value) ? value.GetString() : null;
        var printFile = settings.TryGetProperty("printFile", out var output) ? output.GetString() : null;
        if (string.IsNullOrWhiteSpace(printer))
            printer = string.IsNullOrWhiteSpace(printFile) ? new PrinterSettings().PrinterName : "Microsoft Print to PDF";
        if (Interlocked.CompareExchange(ref submittingJobs, 1, 0) != 0)
            throw new InvalidOperationException("有任务正在提交到打印机，请稍后再试");
        try
        {
            var sheets = SheetCount(pages, layout);
            var job = new InvoiceJob(printer, sheets * layout.Copies);
            job.Print(layout, pages, printFile);
            return new { success = true, pages = sheets, images = pages.Count, layout = layout.PerSheet, printer, printFile };
        }
        finally { Interlocked.Exchange(ref submittingJobs, 0); }
    }

    private static object LookupJob(string id) => Jobs.TryGetValue(id, out var job) ? job.Snapshot() :
        new { id, state = "unknown", message = "当前无法确认队列状态，请查看打印机队列", terminal = true };
}
