using System.Text.Json;

// Bounded, process-local transfers keep individual DBX bridge messages well below 2MiB.
internal static class JsonTransport
{
    private sealed class Transfer(string method, int length)
    {
        public string Method { get; } = method;
        public int Expected { get; } = length;
        public MemoryStream Input { get; } = new();
        public byte[]? Output { get; set; }
        public DateTime Access { get; set; } = DateTime.UtcNow;
    }
    private static readonly Dictionary<string, Transfer> Transfers = new();
    public static object? Call(string method, JsonElement parameters)
    {
        foreach (var stale in Transfers.Where(p => DateTime.UtcNow - p.Value.Access > TimeSpan.FromMinutes(2)).Select(p => p.Key).ToArray())
        { Transfers[stale].Input.Dispose(); Transfers.Remove(stale); }
        if (method == "json/transport/open")
        {
            var operation = parameters.GetProperty("method").GetString() ?? "";
            if (operation is not ("json/filter" or "json/session/load" or "json/session/save")) throw new InvalidOperationException("不支持的 JSON 操作");
            var length = parameters.GetProperty("length").GetInt32();
            if (length < 0 || length > 40 * 1024 * 1024 || Transfers.Count >= 4) throw new InvalidOperationException("JSON 传输超过限制");
            var id = Guid.NewGuid().ToString("N"); Transfers.Add(id, new Transfer(operation, length)); return new { id };
        }
        var transferId = parameters.GetProperty("id").GetString() ?? "";
        if (!Transfers.TryGetValue(transferId, out var transfer)) throw new InvalidOperationException("JSON 传输已过期");
        transfer.Access = DateTime.UtcNow;
        if (method == "json/transport/release")
        { transfer.Input.Dispose(); Transfers.Remove(transferId); return new { released = true }; }
        if (method == "json/transport/write")
        {
            if (transfer.Output != null) throw new InvalidOperationException("传输已执行");
            var data = parameters.GetProperty("data").GetString() ?? "";
            if (data.Length > 100_000) throw new InvalidOperationException("传输块过大");
            var bytes = Convert.FromBase64String(data);
            if (parameters.GetProperty("offset").GetInt32() != transfer.Input.Length || transfer.Input.Length + bytes.Length > transfer.Expected)
                throw new InvalidOperationException("传输块偏移或长度错误");
            transfer.Input.Write(bytes); return new { written = bytes.Length };
        }
        if (method == "json/transport/execute")
        {
            if (transfer.Output != null || transfer.Input.Length != transfer.Expected) throw new InvalidOperationException("传输不完整或已执行");
            using var request = JsonDocument.Parse(transfer.Input.ToArray(), new JsonDocumentOptions { MaxDepth = 256 });
            var result = transfer.Method switch
            {
                "json/filter" => JsonTools.Filter(request.RootElement),
                "json/session/load" => JsonTools.LoadSession(),
                "json/session/save" => JsonTools.SaveSession(request.RootElement),
                _ => throw new InvalidOperationException("不支持的操作"),
            };
            transfer.Output = JsonSerializer.SerializeToUtf8Bytes(result);
            transfer.Input.Dispose();
            return new { length = transfer.Output.Length };
        }
        if (method == "json/transport/read" && transfer.Output != null)
        {
            var offset = parameters.GetProperty("offset").GetInt32();
            if (offset < 0 || offset > transfer.Output.Length) throw new InvalidOperationException("读取偏移错误");
            var count = Math.Min(65536, transfer.Output.Length - offset);
            return new { data = Convert.ToBase64String(transfer.Output, offset, count), length = count };
        }
        throw new InvalidOperationException("未知 JSON 传输方法");
    }
}
