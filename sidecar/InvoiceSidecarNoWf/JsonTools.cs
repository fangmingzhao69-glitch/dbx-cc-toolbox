using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Numerics;
using Jint;

// No CLR access, host objects or print/filesystem callbacks are installed in the JS engine.
internal static class JsonTools
{
    private static readonly Lazy<string> Lodash = new(() =>
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("JsonFilter.lodash.js")
            ?? throw new InvalidOperationException("缺少 lodash 资源");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    });

    public static object Filter(JsonElement parameters)
    {
        var text = parameters.GetProperty("text").GetString() ?? "";
        var code = parameters.GetProperty("code").GetString() ?? "";
        if (text.Length > 20 * 1024 * 1024 || code.Length > 100_000)
            throw new InvalidOperationException("筛选输入或代码超过限制");
        using var input = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 256 });
        CheckInput(input.RootElement);
        var engine = new Engine(options => options
            .TimeoutInterval(TimeSpan.FromSeconds(2))
            .LimitMemory(128 * 1024 * 1024)
            .LimitRecursion(128)
            .MaxStatements(1_000_000));
        engine.Execute(Lodash.Value);
        engine.SetValue("__inputText", text);
        // Capture JSON methods before running user code. JSON.stringify must not silently
        // erase undefined/functions or replace NaN/Infinity with null.
        var script = "(function(){ const stringify = JSON.stringify, finite = Number.isFinite; " +
            "const data = JSON.parse(__inputText), source = new WeakMap(), origins = []; let count=0; " +
            "const segment = k => k.replace(/~/g,'~0').replace(/\\//g,'~1'); " +
            "function index(v,p){if(v && typeof v==='object'){if(++count>100000)throw Error('筛选对象超过限制');source.set(v,p);for(const k of Object.keys(v))index(v[k],p+'/'+segment(k));}} index(data,''); " +
            "const run = function(data, _) {\n" + code + "\n}; " +
            "const result = run(data, _); const output = stringify(result, function(k,v){ " +
            "if(v === undefined || typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint' || " +
            "(typeof v === 'number' && !finite(v))) throw Error('结果包含非 JSON 值'); return v; }); " +
            "if(output === undefined) throw Error('筛选函数需要 return JSON 结果'); " +
            "function locate(v,p){if(v && typeof v==='object'){if(source.has(v))origins.push([p,source.get(v)]);for(const k of Object.keys(v))locate(v[k],p+'/'+segment(k));}} locate(result,''); " +
            "return stringify({text:output,origins:origins}); })()";
        var envelope = engine.Evaluate(script).AsString();
        using var envelopeDocument = JsonDocument.Parse(envelope);
        var output = envelopeDocument.RootElement.GetProperty("text").GetString()!;
        if (output.Length > 4 * 1024 * 1024) throw new InvalidOperationException("筛选结果超过 4MiB，请缩小范围");
        using var validation = JsonDocument.Parse(output, new JsonDocumentOptions { MaxDepth = 256 });
        return new { text = output, origins = envelopeDocument.RootElement.GetProperty("origins").Clone() };
    }

    private static string DecimalKey(string raw)
    {
        var match = Regex.Match(raw, @"^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$");
        if (!match.Success || match.Groups[4].Length > 1000) return raw;
        var digits = (match.Groups[2].Value + match.Groups[3].Value).TrimStart('0');
        if (digits.Length == 0) return match.Groups[1].Value + "0";
        var exponent = BigInteger.Parse(match.Groups[4].Success ? match.Groups[4].Value : "0") - match.Groups[3].Length;
        var trimmed = digits.TrimEnd('0');
        exponent += digits.Length - trimmed.Length;
        return match.Groups[1].Value + trimmed + "e" + exponent;
    }

    private static void CheckInput(JsonElement node)
    {
        if (node.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var field in node.EnumerateObject())
            {
                if (!names.Add(field.Name)) throw new InvalidOperationException("包含重复字段，不能转换为 JavaScript 对象");
                CheckInput(field.Value);
            }
        }
        else if (node.ValueKind == JsonValueKind.Array)
            foreach (var item in node.EnumerateArray()) CheckInput(item);
        else if (node.ValueKind == JsonValueKind.Number)
        {
            if (!node.TryGetDouble(out var number) || !double.IsFinite(number) ||
                DecimalKey(node.GetRawText()) != DecimalKey(number == 0 ? "0" : JsonSerializer.Serialize(number)))
                throw new InvalidOperationException("输入数字不能保真转换为 JavaScript Number，已拒绝筛选");
        }
    }

    private static string SessionPath()
    {
        var directory = Environment.GetEnvironmentVariable("DBX_PLUGIN_DATA_DIR");
        if (string.IsNullOrWhiteSpace(directory))
            throw new InvalidOperationException("宿主未提供插件数据目录，文档无法自动恢复，请先导出");
        // Fixed path beneath the directory supplied by DBX; no user filename is accepted.
        var root = Path.GetFullPath(directory);
        var sessionDirectory = Path.Combine(root, "json-workbench");
        Directory.CreateDirectory(sessionDirectory);
        return Path.Combine(sessionDirectory, "session.json");
    }

    public static object? LoadSession()
    {
        var path = SessionPath();
        if (!File.Exists(path)) return null;
        if (new FileInfo(path).Length > 40 * 1024 * 1024) throw new InvalidOperationException("文档恢复文件超过 40MiB");
        using var doc = JsonDocument.Parse(File.ReadAllText(path, Encoding.UTF8), new JsonDocumentOptions { MaxDepth = 256 });
        return doc.RootElement.Clone();
    }

    public static object SaveSession(JsonElement parameters)
    {
        var session = parameters.GetProperty("session");
        var tabs = session.GetProperty("tabs");
        if (tabs.ValueKind != JsonValueKind.Array || tabs.GetArrayLength() > 50)
            throw new InvalidOperationException("最多自动保存 50 个解析窗口");
        foreach (var tab in tabs.EnumerateArray())
        {
            if (tab.GetProperty("text").ValueKind != JsonValueKind.String || tab.GetProperty("text").GetString()!.Length > 20 * 1024 * 1024)
                throw new InvalidOperationException("单个文档超过 20MiB，无法自动保存");
        }
        var bytes = Encoding.UTF8.GetBytes(session.GetRawText());
        if (bytes.Length > 40 * 1024 * 1024) throw new InvalidOperationException("自动保存总量超过 40MiB，请导出部分文档");
        var path = SessionPath();
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllBytes(temporary, bytes);
            File.Move(temporary, path, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
        return new { saved = true };
    }
}
