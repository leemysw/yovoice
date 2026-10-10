using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;
using Forms = System.Windows.Forms;

namespace VoiceWorkbench.Desktop;
public partial class MainWindow : Window
{
    private readonly LocalService service = new();
    private readonly AppUpdater updater;
    private string Origin => service.Origin;
    private WebView2CompositionControl? web;
    private bool recovering;
    private bool closed;
    private bool shuttingDown;
    private bool shutdownComplete;
    private bool exitRequested;
    private readonly Forms.NotifyIcon tray;
    private readonly Forms.ContextMenuStrip trayMenu;
    private readonly System.Drawing.Icon trayIcon;
    private string WindowPlacementPath => Path.Combine(service.Root, "window-placement.json");
    public MainWindow()
    {
        InitializeComponent();
        StateChanged += (_, _) =>
        {
            bool maximized = WindowState == WindowState.Maximized;
            MaximizeGlyph.Text = maximized ? "\uE923" : "\uE922";
            MaximizeButton.ToolTip = maximized ? "还原" : "最大化";
            System.Windows.Automation.AutomationProperties.SetName(MaximizeButton, maximized ? "还原" : "最大化");
        };
        using (var stream = System.Windows.Application.GetResourceStream(new Uri("Resources/AppIcon.ico", UriKind.Relative)).Stream)
            trayIcon = new System.Drawing.Icon(stream);
        trayMenu = new Forms.ContextMenuStrip();
        trayMenu.Items.Add("打开 yovoice", null, (_, _) => RestoreWindow());
        trayMenu.Items.Add("退出 yovoice", null, (_, _) => RequestExit());
        tray = new Forms.NotifyIcon { Icon = trayIcon, Text = "yovoice", ContextMenuStrip = trayMenu, Visible = true };
        tray.MouseClick += (_, e) => { if (e.Button == Forms.MouseButtons.Left) RestoreWindow(); };
        updater = new AppUpdater(this, CheckUpdatesMenu, service.Root);
        service.StateChanged += json => { if (!closed) _ = Dispatcher.InvokeAsync(() => PostJson(json)); };
        service.Failed += error => { if (!closed && !shuttingDown) _ = Dispatcher.InvokeAsync(() => AppDialog.Show(this, "本地服务已停止", error)); };
        Loaded += async (_, _) => { await InitializeWebAsync(); updater.Start(); };
        Closing += async (_, e) =>
        {
            if (shutdownComplete) return;
            e.Cancel = true;
            WindowPlacement.Capture(new WindowInteropHelper(this).Handle).Save(WindowPlacementPath);
            // 普通关闭只隐藏窗口；显式退出和更新安装才进入保存、停止服务流程。
            if (!exitRequested && !updater.InstallRequested) { Hide(); return; }
            exitRequested = false;
            if (shuttingDown) return;
            shuttingDown = true;
            HostLog.Write(service.Root, "exit.requested");
            try
            {
                if (web?.CoreWebView2 is not null && await IsOperationRunningAsync() && !AppDialog.Show(this, "退出 yovoice？", "当前操作尚未结束。退出将取消操作，已下载的部分文件和正文会保留。", "退出", "继续使用")) { shuttingDown = false; updater.CancelInstall(); return; }
                // 关闭前读取最新正文，避免自动保存的防抖窗口丢字。
                if (web?.CoreWebView2 is not null)
                {
                    string json = await web.CoreWebView2.ExecuteScriptAsync("window.__workbenchDraft ?? null");
                    if (json != "null")
                    {
                        try { HostLog.Write(service.Root, "exit.save_started"); await service.CallAsync("draft.save", JsonSerializer.Deserialize<JsonElement>(json)); HostLog.Write(service.Root, "exit.save_completed"); }
                        catch (Exception error)
                        {
                            HostLog.Write(service.Root, "exit.save_failed", error);
                            if (!AppDialog.Show(this, "作品保存失败", error.Message + "\n\n可以备份当前作品后退出，或返回继续编辑。", "备份后退出", "返回编辑")) { shuttingDown = false; updater.CancelInstall(); return; }
                            var backup = new SaveFileDialog { Filter = "作品恢复备份|*.json", DefaultExt = ".json", FileName = "yovoice-recovery-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".json", OverwritePrompt = true };
                            if (backup.ShowDialog(this) != true) { shuttingDown = false; updater.CancelInstall(); return; }
                            DraftRecovery.Save(backup.FileName, json);
                            HostLog.Write(service.Root, "exit.backup_completed");
                            // 保存失败时仅退出，不继续执行更新安装。
                            updater.CancelInstall();
                        }
                    }
                }
                await updater.PrepareInstallAsync();
                await service.ShutdownAsync();
                updater.CommitInstall();
                HostLog.Write(service.Root, "exit.completed");
                shutdownComplete = true; Close();
            }
            catch (Exception error)
            {
                HostLog.Write(service.Root, "exit.failed", error);
                updater.CancelInstall();
                // 服务停止或更新准备失败时必须留出退出路径，否则只能用任务管理器结束。
                if (!AppDialog.Show(this, "未能安全退出", error.Message + "\n\n可以稍后重试，或直接结束本地服务后退出；未保存的编辑可能丢失。", "仍要退出", "返回")) { shuttingDown = false; return; }
                service.Stop();
                HostLog.Write(service.Root, "exit.forced");
                shutdownComplete = true; Close();
            }
        };
        Closed += (_, _) => { closed = true; tray.Visible = false; tray.Dispose(); trayMenu.Dispose(); trayIcon.Dispose(); updater.Dispose(); service.Dispose(); web?.Dispose(); };
    }
    // 查询仅用于提示；本地服务已停止时视为没有运行中的操作，后续保存失败会提供备份后退出。
    private async Task<bool> IsOperationRunningAsync()
    {
        try
        {
            var result = await service.CallAsync("state.get", new { });
            return result.GetProperty("state").TryGetProperty("activity", out var activity) && activity.ValueKind == JsonValueKind.Object && activity.GetProperty("status").GetString() == "running";
        }
        catch (Exception error)
        {
            HostLog.Write(service.Root, "exit.state_failed", error);
            return false;
        }
    }
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var handle = new WindowInteropHelper(this).Handle;
        // HWND 已确定所在屏幕；使用原生坐标恢复，避免居中逻辑覆盖保存的位置。
        WindowStartupLocation = WindowStartupLocation.Manual;
        MinWidth = MinHeight = 0;
        if (WindowPlacement.Load(WindowPlacementPath) is { } placement) placement.Apply(handle);
        FitWindowToScreen();
        // 交由 DWM 绘制系统圆角和窗口效果。
        const int windowCornerPreference = 33, systemBackdropType = 38;
        int roundCorners = 2, mainWindowBackdrop = 2;
        _ = DwmSetWindowAttribute(handle, windowCornerPreference, ref roundCorners, sizeof(int));
        _ = DwmSetWindowAttribute(handle, systemBackdropType, ref mainWindowBackdrop, sizeof(int));
    }
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);
    private void RestoreWindow()
    {
        Show();
        FitWindowToScreen();
        Activate();
    }
    private void FitWindowToScreen()
    {
        var handle = new WindowInteropHelper(this).Handle;
        var screen = Forms.Screen.FromHandle(handle);
        var area = screen.WorkingArea;
        double scale = GetDpiForWindow(handle) / 96.0;
        MinWidth = Math.Min(840, area.Width / scale);
        MinHeight = Math.Min(640, area.Height / scale);
        var placement = WindowPlacement.Capture(handle);
        // 工作区坐标扣除了屏幕顶部、左侧任务栏的偏移。
        placement.Fit(screen.Bounds.Left, screen.Bounds.Top, area.Width, area.Height);
        placement.Apply(handle);
    }
    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr handle);
    public void RequestExit()
    {
        if (shuttingDown) return;
        RestoreWindow();
        exitRequested = true;
        Close();
    }
    private void ExitMenu_Click(object sender, RoutedEventArgs e) => RequestExit();
    private void ShowWindowMenu_Click(object sender, RoutedEventArgs e)
    {
        var icon = (FrameworkElement)sender;
        SystemCommands.ShowSystemMenu(this, icon.PointToScreen(new Point(0, icon.ActualHeight)));
    }
    private void Minimize_Click(object sender, RoutedEventArgs e) => SystemCommands.MinimizeWindow(this);
    private void Maximize_Click(object sender, RoutedEventArgs e)
    {
        if (WindowState == WindowState.Maximized) SystemCommands.RestoreWindow(this);
        else SystemCommands.MaximizeWindow(this);
    }
    private void Close_Click(object sender, RoutedEventArgs e) => Close();
    private async void ToggleSidebar_Click(object sender, RoutedEventArgs e)
    {
        if (web?.CoreWebView2 is null || recovering || shuttingDown) return;
        try { await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('workbench-toggle-sidebar'))"); }
        catch (InvalidOperationException) { }
    }
    private async Task InitializeWebAsync()
    {
        if (recovering || closed) return;
        recovering = true;
        try
        {
            await service.StartAsync();
            web?.Dispose(); Container.Children.Clear();
            web = new WebView2CompositionControl(); Container.Children.Add(web);
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(service.Root, "web-cache"));
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            // 桌面界面跟随系统 DPI，禁止 Ctrl＋滚轮及缩放快捷键改变页面比例。
            core.Settings.IsZoomControlEnabled = false;
            web.ZoomFactor = 1;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
#if !DEBUG
            core.Settings.AreDevToolsEnabled = false;
#endif
            string assets = Path.Combine(AppContext.BaseDirectory, "web");
            if (!File.Exists(Path.Combine(assets, "index.html"))) throw new IOException("界面文件缺失，请运行构建脚本或重新安装应用。");
            var cookie = core.CookieManager.CreateCookie(service.CookieName, service.Token, "127.0.0.1", "/");
            cookie.IsHttpOnly = true;
            core.CookieManager.AddOrUpdateCookie(cookie);
            string sidebarFile = Path.Combine(service.Root, "sidebar.json");
            string sidebar = File.Exists(sidebarFile) ? await File.ReadAllTextAsync(sidebarFile) : "";
            await core.AddScriptToExecuteOnDocumentCreatedAsync("window.__workbenchMediaBase = '/media/'; const savedSidebar = " + JsonSerializer.Serialize(sidebar) + "; if (savedSidebar) localStorage.setItem('astryx-resizable:workbench-sidebar', savedSidebar);");
            core.NavigationStarting += (_, args) => { if (!Trusted(args.Uri)) args.Cancel = true; };
            // 页面不开新窗口；用户点击打开的 https 链接（如获取 AI 密钥）交给系统浏览器。
            core.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                if (args.IsUserInitiated && Uri.TryCreate(args.Uri, UriKind.Absolute, out var link) && link.Scheme == Uri.UriSchemeHttps)
                    Process.Start(new ProcessStartInfo(link.AbsoluteUri) { UseShellExecute = true });
            };
            core.PermissionRequested += (_, args) => args.State = Trusted(args.Uri) && args.PermissionKind == CoreWebView2PermissionKind.Microphone ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
            core.WebMessageReceived += async (_, args) => await HandleMessageAsync(args);
            // 浏览器进程失效时必须重建控件，任务和草稿继续由 Go 服务持有。
            core.ProcessFailed += (_, _) => _ = Dispatcher.InvokeAsync(InitializeWebAsync);
            core.Navigate(Origin + "/index.html");
        }
        catch (Exception error)
        {
            Container.Children.Clear();
            var panel = new System.Windows.Controls.StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, MaxWidth = 560 };
            panel.Children.Add(new System.Windows.Controls.TextBlock { Text = "界面无法打开。请确认已安装 Microsoft WebView2 Runtime。\n" + error.Message, TextWrapping = TextWrapping.Wrap });
            var retry = new System.Windows.Controls.Button { Content = "重试", Margin = new Thickness(0, 20, 0, 0) };
            retry.Click += async (_, _) => await InitializeWebAsync(); panel.Children.Add(retry); Container.Children.Add(panel);
        }
        finally { recovering = false; }
    }
    private bool Trusted(string uri) => Uri.TryCreate(uri, UriKind.Absolute, out var value) && value.GetLeftPart(UriPartial.Authority) == Origin;
    private async Task HandleMessageAsync(CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!Trusted(args.Source)) return;
        string? id = null;
        string method = "unknown";
        try
        {
            string raw = args.WebMessageAsJson;
            if (raw.Length > 28 * 1024 * 1024) throw new ArgumentException("请求体积超出限制。");
            using var doc = JsonDocument.Parse(raw);
            var message = doc.RootElement;
            id = message.GetProperty("id").GetString();
            method = message.GetProperty("method").GetString()!;
            var data = message.GetProperty("data");
            object? result;
            switch (method)
            {
                case "sidebar.save":
                    double size = data.GetProperty("size").GetDouble();
                    bool collapsed = data.GetProperty("isCollapsed").GetBoolean();
                    if (!double.IsFinite(size) || size < 180 || size > 360) throw new ArgumentException("侧栏设置无效。");
                    string sidebarPath = Path.Combine(service.Root, "sidebar.json");
                    File.WriteAllText(sidebarPath + ".tmp", JsonSerializer.Serialize(new { size, isCollapsed = collapsed }));
                    File.Move(sidebarPath + ".tmp", sidebarPath, true); result = true; break;
                case "project.export":
                    var projectSave = new SaveFileDialog { Filter = "Yovoice 工程|*.yovoice", DefaultExt = ".yovoice", FileName = Path.GetFileName(data.GetProperty("name").GetString() ?? "project"), OverwritePrompt = true };
                    result = projectSave.ShowDialog(this) == true ? await service.CallAsync(method, new { id = data.GetProperty("id").GetString(), path = projectSave.FileName }) : false; break;
                case "project.import":
                    var projectOpen = new OpenFileDialog { Filter = "Yovoice 工程|*.yovoice" };
                    result = projectOpen.ShowDialog(this) == true ? await service.CallAsync(method, new { path = projectOpen.FileName }) : null; break;
                case "score.import":
                    var scoreOpen = new OpenFileDialog { Filter = "MIDI 或乐谱|*.mid;*.midi;*.json" };
                    result = scoreOpen.ShowDialog(this) == true ? await service.CallAsync(method, new { path = scoreOpen.FileName }) : null; break;
                case "score.export":
                    // 编曲导出 MIDI 或乐谱 JSON，扩展名由界面指定，写文件交给本地服务。
                    string scoreFormat = data.TryGetProperty("format", out var formatValue) && formatValue.GetString() == "json" ? "json" : "mid";
                    var scoreSave = new SaveFileDialog { Filter = scoreFormat == "json" ? "乐谱 JSON|*.json" : "MIDI|*.mid", DefaultExt = "." + scoreFormat, FileName = Path.GetFileName(data.GetProperty("name").GetString() ?? "score") + "." + scoreFormat, OverwritePrompt = true };
                    result = scoreSave.ShowDialog(this) == true ? await service.CallAsync(method, new { path = scoreSave.FileName, score = data.GetProperty("score") }) : false; break;
                case "audio.export":
                    string encoded = data.GetProperty("base64").GetString() ?? "";
                    if (encoded.Length > 240_000_000) throw new ArgumentException("导出音频超过大小限制。");
                    byte[] wav = Convert.FromBase64String(encoded);
                    if (wav.Length < 44 || System.Text.Encoding.ASCII.GetString(wav, 0, 4) != "RIFF" || System.Text.Encoding.ASCII.GetString(wav, 8, 4) != "WAVE") throw new ArgumentException("导出音频格式无效。");
                    var save = new SaveFileDialog { Filter = "WAV 音频|*.wav", DefaultExt = ".wav", FileName = Path.GetFileName(data.GetProperty("name").GetString() ?? "yovoice.wav"), OverwritePrompt = true };
                    if (save.ShowDialog(this) != true) { result = false; break; }
                    string temporary = save.FileName + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    try { await File.WriteAllBytesAsync(temporary, wav); File.Move(temporary, save.FileName, true); }
                    finally { if (File.Exists(temporary)) File.Delete(temporary); }
                    result = true; break;
                case "media.reveal":
                    var location = await service.CallAsync("media.path", data);
                    string path = location.GetString()!;
                    if (!File.Exists(path)) throw new FileNotFoundException("音频文件不存在。");
                    var explorer = new ProcessStartInfo("explorer.exe");
                    explorer.ArgumentList.Add("/select,"); explorer.ArgumentList.Add(path);
                    Process.Start(explorer); result = true; break;
                case "voice.import":
                    var audio = new OpenFileDialog { Filter = "音频文件|*.wav;*.mp3;*.m4a;*.aac;*.flac;*.ogg;*.opus;*.aiff;*.aif;*.wma;*.webm", Title = "选择 1–60 秒的音色参考" };
                    result = audio.ShowDialog(this) == true ? await service.CallAsync(method, new { path = audio.FileName }) : null; break;
                case "model.import":
                case "model.directory":
                    string? selected = null;
                    if (method == "model.directory" || (data.TryGetProperty("directory", out var directory) && directory.GetBoolean()))
                    {
                        var folder = new OpenFolderDialog { Title = "选择模型目录" };
                        if (folder.ShowDialog(this) == true) selected = folder.FolderName;
                    }
                    else
                    {
                        var file = new OpenFileDialog { Filter = "GGUF 模型|*.gguf", Title = "导入 audio.cpp IndexTTS 模型" };
                        if (file.ShowDialog(this) == true) selected = file.FileName;
                    }
                    result = selected is null ? null : await service.CallAsync(method, new { path = selected }); break;
                case "model.directory.open":
                    var state = (await service.CallAsync("state.get", new { })).GetProperty("state");
                    string modelDirectory = state.GetProperty("preferences").GetProperty("modelDirectory").GetString() ?? Path.Combine(service.Root, "models");
                    Directory.CreateDirectory(modelDirectory);
                    Process.Start(new ProcessStartInfo(modelDirectory) { UseShellExecute = true }); result = true; break;
                case "logs.open":
                    Process.Start(new ProcessStartInfo(Path.Combine(service.Root, "logs")) { UseShellExecute = true }); result = true; break;
                default: result = await service.CallAsync(method, data); break;
            }
            Post(new { id, result });
        }
        catch (ServiceCallException error) { HostLog.Write(service.Root, "rpc.failed:" + method, error); Post(new { id, error = error.Wire }); }
        catch (Exception error) { HostLog.Write(service.Root, "bridge.failed:" + method, error); Post(new { id, error = error.Message }); }
    }
    private void Post(object value) => PostJson(JsonSerializer.Serialize(value));
    private void PostJson(string json)
    {
        if (closed || web?.CoreWebView2 is null) return;
        try { web.CoreWebView2.PostWebMessageAsJson(json); }
        catch (InvalidOperationException) { }
    }
}
