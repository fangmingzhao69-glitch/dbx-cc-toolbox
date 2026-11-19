using System.Drawing;
using System.Drawing.Printing;
using System.Runtime.InteropServices;

internal sealed class InvoiceJob(string printer, int total)
{
    private readonly object gate = new();
    private string state = "sending";
    private string message = "正在准备并提交打印";
    private int rendered;
    private bool terminal;

    public string Id { get; } = Guid.NewGuid().ToString("N");
    public DateTime Created { get; } = DateTime.UtcNow;
    public bool IsTerminal { get { lock (gate) return terminal; } }
    private string DocumentName => "CC Invoice " + Id;

    public object Snapshot()
    {
        lock (gate) return new { id = Id, created = Created, printer, total, rendered, state, message, terminal };
    }

    private void Update(string newState, string newMessage, bool isTerminal = false)
    {
        lock (gate) { state = newState; message = newMessage; terminal = isTerminal; }
    }

    public void Fail(string error) => Update("failed", "打印提交失败，重新提交前请核对系统队列：" + error, true);

    public void Print(InvoiceLayout layout, IReadOnlyList<InvoicePage> pages, string? printFile = null)
    {
        using var document = new PrintDocument
        {
            DocumentName = DocumentName,
            PrintController = new StandardPrintController(),
            OriginAtMargins = false
        };
        document.PrinterSettings.PrinterName = printer;
        if (!document.PrinterSettings.IsValid) throw new InvalidOperationException("打印机不可用：" + printer);
        document.PrinterSettings.Copies = 1;
        if (!string.IsNullOrWhiteSpace(printFile))
        {
            document.PrinterSettings.PrintToFile = true;
            document.PrinterSettings.PrintFileName = printFile;
        }
        var landscape = layout.Width > layout.Height;
        int ToPaperUnits(float millimeters) => (int)Math.Round(millimeters / .254f);
        var width = ToPaperUnits(Math.Min(layout.Width, layout.Height));
        var height = ToPaperUnits(Math.Max(layout.Width, layout.Height));
        var paper = document.PrinterSettings.PaperSizes.Cast<PaperSize>()
            .FirstOrDefault(p => Math.Abs(p.Width - width) <= 2 && Math.Abs(p.Height - height) <= 2);
        document.DefaultPageSettings.PaperSize = paper ?? new PaperSize("CC Invoice", width, height);
        document.DefaultPageSettings.Landscape = landscape;
        document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
        ApplyQuality(document, layout.Quality);
        var sheets = (pages.Count + layout.PerSheet - 1) / layout.PerSheet;
        document.PrintPage += (_, args) =>
        {
            var graphics = args.Graphics ?? throw new InvalidOperationException("打印机没有提供绘图表面");
            var physicalWidth = args.PageBounds.Width * .254f;
            var physicalHeight = args.PageBounds.Height * .254f;
            if (Math.Abs(physicalWidth - layout.Width) > 2 || Math.Abs(physicalHeight - layout.Height) > 2)
                throw new InvalidOperationException("打印机未接受所选纸张尺寸或方向");
            graphics.PageUnit = GraphicsUnit.Millimeter;
            graphics.TranslateTransform(-args.PageSettings.HardMarginX * .254f, -args.PageSettings.HardMarginY * .254f);
            layout.Draw(graphics, pages, rendered % sheets, draftPreview: false);
            lock (gate) { rendered++; args.HasMorePages = rendered < total; }
        };
        document.Print();
        Update("submitted", "已提交，正在查询系统打印队列");
    }

    private static void ApplyQuality(PrintDocument document, string quality)
    {
        if (quality == "normal") return;
        var resolutions = document.PrinterSettings.PrinterResolutions.Cast<PrinterResolution>().ToList();
        var kind = quality == "high" ? PrinterResolutionKind.High : PrinterResolutionKind.Draft;
        var resolution = resolutions.FirstOrDefault(r => r.Kind == kind);
        if (resolution is null)
        {
            var available = resolutions.Where(r => r.X > 0 && r.Y > 0).OrderBy(r => (long)r.X * r.Y);
            resolution = quality == "high" ? available.LastOrDefault() : available.FirstOrDefault();
        }
        if (resolution is not null) document.DefaultPageSettings.PrinterResolution = resolution;
    }

    public void StartMonitoring()
    {
        if (IsTerminal) return;
        _ = Task.Run(async () =>
        {
            var seen = false;
            string? lastIssue = null;
            for (var attempt = 0; attempt < 30; attempt++)
            {
                try
                {
                    var job = PrinterQueue.Find(printer, DocumentName);
                    if (job is not null)
                    {
                        seen = true;
                        var flags = job.Value;
                        if ((flags & (0x80 | 0x1000)) != 0) { Update("completed", "系统打印队列报告任务完成", true); return; }
                        if ((flags & 0x100) != 0) { Update("cancelled", "系统打印队列报告任务已删除", true); return; }
                        lastIssue = (flags & 0x40) != 0 ? "缺纸" : (flags & 0x20) != 0 ? "打印机离线" :
                            (flags & 0x400) != 0 ? "需要人工处理" : (flags & 0x200) != 0 ? "打印受阻" :
                            (flags & 0x02) != 0 ? "打印机报错" : (flags & 0x01) != 0 ? "任务暂停" : null;
                        if (lastIssue is not null) Update("attention", lastIssue + "，任务仍在系统队列");
                        else if ((flags & 0x10) != 0) Update("printing", "系统打印队列正在处理任务");
                        else Update("queued", "任务在系统打印队列中");
                    }
                    else if (seen) { Update("unconfirmed", "任务已离开队列，系统未报告出纸结果", true); return; }
                }
                catch (Exception error) { Update("unconfirmed", "已提交，但无法读取队列：" + error.Message, true); return; }
                await Task.Delay(2000);
            }
            Update("unconfirmed", lastIssue is null ? "已提交，60 秒内未确认完成。请查看系统打印队列" :
                lastIssue + "。请查看系统打印队列", true);
        });
    }
}

internal static class PrinterQueue
{
    [StructLayout(LayoutKind.Sequential)]
    private struct JobInfo
    {
        public uint Id;
        public IntPtr Printer, Machine, User, Document, DataType, StatusText;
        public uint Status, Priority, Position, TotalPages, PagesPrinted;
        public SystemTime Submitted;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SystemTime
    {
        public ushort Year, Month, DayOfWeek, Day, Hour, Minute, Second, Millisecond;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);

    [DllImport("winspool.drv", EntryPoint = "EnumJobsW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumJobs(IntPtr handle, uint first, uint count, uint level, IntPtr buffer, uint capacity,
        out uint needed, out uint returned);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ClosePrinter(IntPtr handle);

    public static uint? Find(string printer, string document)
    {
        if (!OpenPrinter(printer, out var handle, IntPtr.Zero))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            for (uint first = 0; first < 10_000; first += 128)
            {
                const uint batchSize = 128;
                if (EnumJobs(handle, first, batchSize, 1, IntPtr.Zero, 0, out var needed, out _)) return null;
                var error = Marshal.GetLastWin32Error();
                if (error != 122 || needed == 0 || needed > 4 * 1024 * 1024)
                    throw new System.ComponentModel.Win32Exception(error);
                var buffer = Marshal.AllocHGlobal((int)needed);
                try
                {
                    if (!EnumJobs(handle, first, batchSize, 1, buffer, needed, out _, out var returned))
                    {
                        error = Marshal.GetLastWin32Error();
                        // The queue grew between sizing and reading. The next poll will retry.
                        if (error == 122) return null;
                        throw new System.ComponentModel.Win32Exception(error);
                    }
                    for (var index = 0; index < returned; index++)
                    {
                        var info = Marshal.PtrToStructure<JobInfo>(buffer + index * Marshal.SizeOf<JobInfo>());
                        if (Marshal.PtrToStringUni(info.Document) == document) return info.Status;
                    }
                    if (returned < batchSize) return null;
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            return null;
        }
        finally { ClosePrinter(handle); }
    }
}
