using System.Drawing;
using System.Drawing.Drawing2D;
using System.Text.Json;

internal sealed record InvoiceLayout(
    float Width, float Height, int Columns, int Rows, float Left, float Top, float Right, float Bottom,
    float Gap, float OffsetX, float OffsetY, bool CutLines, int Copies, string Quality)
{
    public int PerSheet => Columns * Rows;
    public int RenderPixels => Quality switch { "draft" => 1100, "high" => 2600, _ => 1754 };

    public static InvoiceLayout Read(JsonElement value)
    {
        float Number(string key, float fallback, float minimum, float maximum)
        {
            if (!value.TryGetProperty(key, out var element)) return fallback;
            if (element.ValueKind != JsonValueKind.Number || !element.TryGetSingle(out var number) ||
                !float.IsFinite(number) || number < minimum || number > maximum)
                throw new ArgumentException($"{key} 的值须在 {minimum} 到 {maximum} 之间");
            return number;
        }

        var width = Number("paperWidthMm", 210, 25, 1000);
        var height = Number("paperHeightMm", 297, 25, 1000);
        var landscape = value.TryGetProperty("orientation", out var orientation)
            ? orientation.GetString() == "landscape" : width > height;
        if (landscape != (width > height)) (width, height) = (height, width);
        var layout = Number("layout", 2, 1, 4);
        var columns = layout == 4 ? 2 : 1;
        var rows = layout is 2 or 4 ? 2 : 1;
        if (layout is not (1 or 2 or 4)) throw new ArgumentException("每页只能排版 1、2 或 4 张");
        var copies = Number("copies", 1, 1, 99);
        if (copies % 1 != 0) throw new ArgumentException("打印份数必须为整数");
        var result = new InvoiceLayout(width, height, columns, rows,
            Number("marginLeftMm", 0, 0, 500), Number("marginTopMm", 0, 0, 500),
            Number("marginRightMm", 0, 0, 500), Number("marginBottomMm", 0, 0, 500),
            Number("gapMm", 4, 0, 100), Number("offsetXmm", 0, -100, 100), Number("offsetYmm", 0, -100, 100),
            value.TryGetProperty("cutLines", out var cutLines) && cutLines.GetBoolean(), (int)copies,
            value.TryGetProperty("quality", out var quality) ? quality.GetString() ?? "normal" : "normal");
        if (result.Area.Width - result.Gap * (columns - 1) <= 1 ||
            result.Area.Height - result.Gap * (rows - 1) <= 1)
            throw new ArgumentException("纸张扣除边距与间距后没有足够的排版空间");
        return result;
    }

    private RectangleF Area => new(Left, Top, Width - Left - Right, Height - Top - Bottom);

    public void Draw(Graphics graphics, IReadOnlyList<InvoicePage> pages, int sheet, bool draftPreview)
    {
        var area = Area;
        var cellWidth = (area.Width - (Columns - 1) * Gap) / Columns;
        var cellHeight = (area.Height - (Rows - 1) * Gap) / Rows;
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        var state = graphics.Save();
        try
        {
            graphics.SetClip(new RectangleF(0, 0, Width, Height), CombineMode.Intersect);
            if (CutLines)
            {
                using var pen = new Pen(Color.Gray, .2f) { DashStyle = DashStyle.Dash };
                for (var col = 1; col < Columns; col++)
                {
                    var x = area.Left + col * (cellWidth + Gap) - Gap / 2 + OffsetX;
                    graphics.DrawLine(pen, x, area.Top + OffsetY, x, area.Bottom + OffsetY);
                }
                for (var row = 1; row < Rows; row++)
                {
                    var y = area.Top + row * (cellHeight + Gap) - Gap / 2 + OffsetY;
                    graphics.DrawLine(pen, area.Left + OffsetX, y, area.Right + OffsetX, y);
                }
            }
            for (var slot = 0; slot < PerSheet && sheet * PerSheet + slot < pages.Count; slot++)
            {
                var page = pages[sheet * PerSheet + slot];
                using var image = page.Source.Render(page.Index, draftPreview ? 1100 : RenderPixels);
                image.RotateFlip(page.Rotation switch
                {
                    90 => RotateFlipType.Rotate90FlipNone,
                    180 => RotateFlipType.Rotate180FlipNone,
                    270 => RotateFlipType.Rotate270FlipNone,
                    _ => RotateFlipType.RotateNoneFlipNone,
                });
                var scale = Math.Min(cellWidth / image.Width, cellHeight / image.Height);
                var width = image.Width * scale;
                var height = image.Height * scale;
                var x = area.Left + (slot % Columns) * (cellWidth + Gap) + (cellWidth - width) / 2 + OffsetX;
                var y = area.Top + (slot / Columns) * (cellHeight + Gap) + (cellHeight - height) / 2 + OffsetY;
                graphics.DrawImage(image, new RectangleF(x, y, width, height),
                    new RectangleF(0, 0, image.Width, image.Height), GraphicsUnit.Pixel);
            }
        }
        finally { graphics.Restore(state); }
    }
}
