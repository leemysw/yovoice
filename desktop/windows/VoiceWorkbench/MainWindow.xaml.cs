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
            // 普通关闭只隐藏窗口；显式退出和更新安装才进入保存、停止服务流程。
            if (!exitRequested && !updater.InstallRequested) { Hide(); return; }
            exitRequested = false;
            if (shuttingDown) return;
            shuttingDown = true;
            try
            {
                if (web?.CoreWebView2 is not null)
                {
                    var result = await service.CallAsync("state.get", new { });
                    if (result.GetProperty("state").TryGetProperty("activity", out var activity) && activity.ValueKind == JsonValueKind.Object && activity.GetProperty("status").GetString() == "running" && !AppDialog.Show(this, "退出 yovoice？", "当前操作尚未结束。退出将取消操作，已下载的部分文件和正文会保留。", "退出", "继续使用")) { shuttingDown = false; updater.CancelInstall(); return; }
                }
                // 关闭前读取最新正文，避免自动保存的防抖窗口丢字。
                if (web?.CoreWebView2 is not null)
                {
                    string json = await web.CoreWebView2.ExecuteScriptAsync("window.__workbenchDraft ?? null");
                    if (json != "null") await service.CallAsync("draft.save", JsonSerializer.Deserialize<JsonElement>(json));
                }
                await updater.PrepareInstallAsync();
                await service.ShutdownAsync();
                updater.CommitInstall();
                shutdownComplete = true; Close();
            }
            catch (Exception error) { shuttingDown = false; updater.CancelInstall(); AppDialog.Show(this, "未能安全保存", error.Message + "\n\n请稍后重试退出。"); }
        };
        Closed += (_, _) => { closed = true; tray.Visible = false; tray.Dispose(); trayMenu.Dispose(); trayIcon.Dispose(); updater.Dispose(); service.Dispose(); web?.Dispose(); };
    }
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        // 与 Nexus 一样交由 DWM 绘制系统圆角和窗口效果，避免自定义标题栏变成无边框平面。
        var handle = new WindowInteropHelper(this).Handle;
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
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }
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
            core.NewWindowRequested += (_, args) => { args.Handled = true; };
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
        try
        {
            string raw = args.WebMessageAsJson;
            if (raw.Length > 28 * 1024 * 1024) throw new ArgumentException("请求体积超出限制。");
            using var doc = JsonDocument.Parse(raw);
            var message = doc.RootElement;
            id = message.GetProperty("id").GetString();
            string method = message.GetProperty("method").GetString()!;
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
        catch (Exception error) { Post(new { id, error = error.Message }); }
    }
    private void Post(object value) => PostJson(JsonSerializer.Serialize(value));
    private void PostJson(string json)
    {
        if (closed || web?.CoreWebView2 is null) return;
        try { web.CoreWebView2.PostWebMessageAsJson(json); }
        catch (InvalidOperationException) { }
    }
}
