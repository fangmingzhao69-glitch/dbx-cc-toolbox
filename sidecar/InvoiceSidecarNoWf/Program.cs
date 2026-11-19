using System.Reflection;
using System.Text.Json;

const string PluginId = "com.cctoolbox.jsongrid";
Console.InputEncoding = new System.Text.UTF8Encoding(false);
Console.OutputEncoding = new System.Text.UTF8Encoding(false);
var assembly = Assembly.GetExecutingAssembly();
var versionText = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+', 2)[0]
    ?? assembly.GetName().Version?.ToString(3)
    ?? "0.1.19";
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
                    capabilities = new[] { "invoice/printers", "invoice/print", "invoice/preview", "invoice/version", "invoice/workspace/open", "invoice/workspace/close", "invoice/files/open",
                        "invoice/files/write", "invoice/files/finish", "invoice/files/remove", "invoice/file/preview", "invoice/job/status", "json/filter", "json/session/load", "json/session/save",
                        "json/transport/open", "json/transport/write", "json/transport/execute", "json/transport/read", "json/transport/release" },
                    plugin = new { id = PluginId, version = versionText },
                },
                "invoice/version" => new { version = versionText, workspaces = true },
                "json/filter" => JsonTools.Filter(parameters),
                "json/session/load" => JsonTools.LoadSession(),
                "json/session/save" => JsonTools.SaveSession(parameters),
                _ when method.StartsWith("json/transport/", StringComparison.Ordinal) => JsonTransport.Call(method, parameters),
                _ when method.StartsWith("invoice/", StringComparison.Ordinal) => InvoiceTools.Call(method, parameters),
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
