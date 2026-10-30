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
    // 数据目录迁移完成后旧目录已冻结写入，退出时不再保存正文，并在退出后自动重新打开应用。
    private bool storageRelocated;
    private bool restartRequested;
    private readonly Forms.NotifyIcon tray;
    private readonly Forms.ContextMenuStrip trayMenu;
    private readonly Forms.ToolStripItem trayOpen;
    private readonly Forms.ToolStripItem trayExit;
    // 本地服务意外停止后正在询问或重新启动，避免重复弹窗。
    private bool serviceRecovering;
    private readonly System.Drawing.Icon trayIcon;
    private string WindowPlacementPath => Path.Combine(service.Root, "window-placement.json");
    public MainWindow()
    {
        // 先按数据目录中保存的界面语言初始化，原生菜单与对话框与网页保持一致。
        HostL10n.LoadFrom(service.Root);
        InitializeComponent();
        AnimateGhost();
        StateChanged += (_, _) => { ApplyMaximizeLabel(); SyncWebVisibility(); };
        // 关闭到托盘（Hide）与最小化一样会留下浏览器的输入窗口，显示状态变化时同样同步。
        IsVisibleChanged += (_, _) => SyncWebVisibility();
        using (var stream = System.Windows.Application.GetResourceStream(new Uri("Resources/AppIcon.ico", UriKind.Relative)).Stream)
            trayIcon = new System.Drawing.Icon(stream);
        trayMenu = new Forms.ContextMenuStrip();
        trayOpen = trayMenu.Items.Add("", null, (_, _) => RestoreWindow());
        trayExit = trayMenu.Items.Add("", null, (_, _) => RequestExit());
        tray = new Forms.NotifyIcon { Icon = trayIcon, Text = "yovoice", ContextMenuStrip = trayMenu, Visible = true };
        tray.MouseClick += (_, e) => { if (e.Button == Forms.MouseButtons.Left) RestoreWindow(); };
        updater = new AppUpdater(this, CheckUpdatesMenu, service.Root);
        updater.Changed += snapshot => { if (!closed) PostJson(JsonSerializer.Serialize(new { @event = "update", update = snapshot }, WebJson)); };
        // 窗口隐藏在托盘时，用系统通知提示新版本已就绪。
        updater.Ready += version => { if (!IsVisible && !closed) tray.ShowBalloonTip(8000, HostL10n.T("yovoice 有新版本", "yovoice Update Available"), HostL10n.T($"{version} 已下载完成，打开 yovoice 重启即可更新。", $"{version} has been downloaded. Open yovoice and restart to update."), Forms.ToolTipIcon.Info); };
        tray.BalloonTipClicked += (_, _) => { RestoreWindow(); ShowUpdateInApp(); };
        updater.ShowInApp = ShowUpdateInApp;
        service.StateChanged += json => { if (!closed) _ = Dispatcher.InvokeAsync(() => PostJson(json)); };
        service.Failed += error => { if (!closed && !shuttingDown) _ = Dispatcher.InvokeAsync(() => RecoverServiceAsync(error)); };
        ApplyLocale();
        HostL10n.Changed += OnLocaleChanged;
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
                if (web?.CoreWebView2 is not null && await IsOperationRunningAsync() && !AppDialog.Show(this, HostL10n.T("退出 yovoice？", "Quit yovoice?"), HostL10n.T("当前操作尚未结束。退出将取消操作，已下载的部分文件和正文会保留。", "An operation is still running. Quitting will cancel it; partially downloaded files and your text are kept."), HostL10n.T("退出", "Quit"), HostL10n.T("继续使用", "Keep Using"))) { shuttingDown = false; updater.CancelInstall(); return; }
                // 关闭前读取最新正文，避免自动保存的防抖窗口丢字。
                if (web?.CoreWebView2 is not null && !storageRelocated)
                {
                    string json = await web.CoreWebView2.ExecuteScriptAsync("window.__workbenchDraft ?? null");
                    if (json != "null")
                    {
                        try { HostLog.Write(service.Root, "exit.save_started"); await service.CallAsync("draft.save", JsonSerializer.Deserialize<JsonElement>(json)); HostLog.Write(service.Root, "exit.save_completed"); }
                        // 迁移完成后旧目录冻结写入，此时保存必然失败且没有意义，不能因此挡住退出。
                        catch (ServiceCallException error) when (error.Code == ServiceCallException.StorageRestartRequired) { HostLog.Write(service.Root, "exit.save_skipped"); }
                        catch (Exception error)
                        {
                            HostLog.Write(service.Root, "exit.save_failed", error);
                            // 保存失败时必须同时提供备份、直接退出和返回编辑，避免数据目录不可用时无法退出。
                            while (true)
                            {
                                if (AppDialog.Show(this, HostL10n.T("作品保存失败", "Couldn't Save Your Work"), error.Message + HostL10n.T("\n\n可以备份当前作品后退出；也可以选择更多选项直接退出或返回编辑。", "\n\nYou can back up your work and quit, or choose More Options to quit without saving or go back to editing."), HostL10n.T("备份后退出", "Back Up and Quit"), HostL10n.T("更多选项", "More Options")))
                                {
                                    // 取消选择备份位置时回到上一步，而不是直接留在编辑页。
                                    if (!BackupDraft(json)) continue;
                                    HostLog.Write(service.Root, "exit.backup_completed");
                                    break;
                                }
                                if (AppDialog.Show(this, HostL10n.T("不保存直接退出？", "Quit Without Saving?"), HostL10n.T("未保存的修改将丢失，且无法恢复。", "Unsaved changes will be lost and can't be recovered."), HostL10n.T("直接退出", "Quit Anyway"), HostL10n.T("返回编辑", "Back to Editing")))
                                {
                                    HostLog.Write(service.Root, "exit.save_discarded");
                                    break;
                                }
                                shuttingDown = false; updater.CancelInstall(); return;
                            }
                            // 保存失败时仅退出，不继续执行更新安装。
                            updater.CancelInstall();
                        }
                    }
                }
                await updater.PrepareInstallAsync();
                await service.ShutdownAsync();
                updater.CommitInstall();
                HostLog.Write(service.Root, "exit.completed");
                if (restartRequested) Relaunch();
                shutdownComplete = true; Close();
            }
            catch (Exception error)
            {
                HostLog.Write(service.Root, "exit.failed", error);
                updater.CancelInstall();
                // 服务停止或更新准备失败时必须留出退出路径，否则只能用任务管理器结束。
                if (!AppDialog.Show(this, HostL10n.T("未能安全退出", "Couldn't Quit Safely"), error.Message + HostL10n.T("\n\n可以稍后重试，或直接结束本地服务后退出；未保存的编辑可能丢失。", "\n\nTry again later, or stop the local service and quit now; unsaved edits may be lost."), HostL10n.T("仍要退出", "Quit Anyway"), HostL10n.T("返回", "Back"))) { shuttingDown = false; return; }
                service.Stop();
                HostLog.Write(service.Root, "exit.forced");
                if (restartRequested) Relaunch();
                shutdownComplete = true; Close();
            }
        };
        Closed += (_, _) => { closed = true; HostL10n.Changed -= OnLocaleChanged; tray.Visible = false; tray.Dispose(); trayMenu.Dispose(); trayIcon.Dispose(); updater.Dispose(); service.Dispose(); web?.Dispose(); };
    }
    // 查询仅用于提示；本地服务已停止时视为没有运行中的操作，后续保存失败会提供备份后退出。
    private async Task<bool> IsOperationRunningAsync()
    {
        try
        {
            var result = await service.CallAsync("state.get", new { });
            // 生成与模型下载分别记录，任一进行中都需要确认。
            var state = result.GetProperty("state");
            return new[] { "activity", "modelActivity" }.Any(key => state.TryGetProperty(key, out var activity) && activity.ValueKind == JsonValueKind.Object && activity.GetProperty("status").GetString() == "running");
        }
        catch (Exception error)
        {
            HostLog.Write(service.Root, "exit.state_failed", error);
            return false;
        }
    }
    private void OnLocaleChanged() => Dispatcher.Invoke(ApplyLocale);
    // 原生菜单、标题栏按钮与托盘文字跟随界面语言，切换后立即刷新。
    private void ApplyLocale()
    {
        FileMenu.Header = HostL10n.T("文件", "File");
        ExitMenu.Header = HostL10n.T("退出 yovoice", "Quit yovoice");
        ViewMenu.Header = HostL10n.T("视图", "View");
        string sidebar = HostL10n.T("切换侧栏", "Toggle Sidebar"), assistant = HostL10n.T("切换 Ocho", "Toggle Ocho"), inspector = HostL10n.T("切换右侧面板", "Toggle Inspector");
        ToggleSidebarMenu.Header = sidebar;
        ToggleAssistantMenu.Header = assistant;
        ToggleInspectorMenu.Header = inspector;
        HelpMenu.Header = HostL10n.T("帮助", "Help");
        SetLabel(WindowMenuButton, "yovoice", HostL10n.T("yovoice 窗口菜单", "yovoice Window Menu"));
        SetLabel(ToggleSidebarButton, sidebar);
        SetLabel(ToggleAssistantButton, assistant);
        SetLabel(ToggleInspectorButton, inspector);
        SetLabel(MinimizeButton, HostL10n.T("最小化", "Minimize"));
        SetLabel(CloseButton, HostL10n.T("关闭", "Close"));
        ApplyMaximizeLabel();
        if (StartupMessage is not null) StartupMessage.Text = HostL10n.T("正在打开 yovoice…", "Opening yovoice…");
        trayOpen.Text = HostL10n.T("打开 yovoice", "Open yovoice");
        trayExit.Text = HostL10n.T("退出 yovoice", "Quit yovoice");
        updater.ApplyLocale();
    }
    // WebView2CompositionControl 另有一个跟随窗口的输入窗口，WPF 最小化或隐藏窗口时不会隐藏它，
    // 会留在原位置拦截鼠标（如桌面右键菜单无法弹出）；最小化或关到托盘时隐藏控件，让它随之隐藏，还原后再显示。
    private void SyncWebVisibility()
    {
        if (web is not null) web.Visibility = WindowState == WindowState.Minimized || !IsVisible ? Visibility.Hidden : Visibility.Visible;
    }
    private void ApplyMaximizeLabel()
    {
        bool maximized = WindowState == WindowState.Maximized;
        MaximizeGlyph.Text = maximized ? "\uE923" : "\uE922";
        SetLabel(MaximizeButton, maximized ? HostL10n.T("还原", "Restore") : HostL10n.T("最大化", "Maximize"));
    }
    private static void SetLabel(System.Windows.Controls.Button button, string tooltip, string? name = null)
    {
        button.ToolTip = tooltip;
        System.Windows.Automation.AutomationProperties.SetName(button, name ?? tooltip);
    }
    // 让用户选择位置保存当前正文的恢复备份；取消选择时返回 false。
    private bool BackupDraft(string json)
    {
        var backup = new SaveFileDialog { Filter = HostL10n.T("作品恢复备份", "Work Recovery Backup") + "|*.json", DefaultExt = ".json", FileName = "yovoice-recovery-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".json", OverwritePrompt = true };
        if (backup.ShowDialog(this) != true) return false;
        DraftRecovery.Save(backup.FileName, json);
        HostLog.Write(service.Root, "draft.backup_completed");
        return true;
    }
    // 本地服务意外停止：先取出界面里尚未保存的正文，由用户选择重新启动或退出；
    // 重启成功后补存正文再重新加载界面，补存失败时提供备份，避免修改丢失。
    private async Task RecoverServiceAsync(string error)
    {
        if (serviceRecovering || recovering || closed || shuttingDown) return;
        serviceRecovering = true;
        try
        {
            string draft = "null";
            if (web?.CoreWebView2 is not null)
            {
                try { draft = await web.CoreWebView2.ExecuteScriptAsync("window.__workbenchDraft ?? null"); }
                catch (Exception readError) when (readError is InvalidOperationException or COMException) { HostLog.Write(service.Root, "service.draft_read_failed", readError); }
            }
            string message = error;
            while (true)
            {
                if (closed || shuttingDown) return;
                RestoreWindow();
                if (!AppDialog.Show(this, HostL10n.T("本地服务已停止", "Local Service Stopped"), message + HostL10n.T("\n\n可以重新启动本地服务继续使用，未保存的修改会在重启后补存。", "\n\nRestart the local service to keep working; unsaved changes will be saved after it restarts."), HostL10n.T("重新启动", "Restart"), HostL10n.T("退出", "Quit")))
                {
                    serviceRecovering = false;
                    RequestExit();
                    return;
                }
                try
                {
                    await service.StartAsync();
                    HostLog.Write(service.Root, "service.restarted");
                    break;
                }
                catch (Exception startError)
                {
                    HostLog.Write(service.Root, "service.restart_failed", startError);
                    message = HostL10n.T("本地服务重新启动失败：", "The local service couldn't restart: ") + startError.Message;
                }
            }
            if (draft != "null")
            {
                try { await service.CallAsync("draft.save", JsonSerializer.Deserialize<JsonElement>(draft)); HostLog.Write(service.Root, "service.draft_restored"); }
                catch (Exception saveError)
                {
                    HostLog.Write(service.Root, "service.draft_restore_failed", saveError);
                    while (AppDialog.Show(this, HostL10n.T("未能补存修改", "Couldn't Restore Your Changes"), saveError.Message + HostL10n.T("\n\n可以将重启前的作品另存为恢复备份；放弃后界面将显示上次保存的内容。", "\n\nYou can save the work from before the restart as a recovery backup. If you discard it, the last saved version will be shown."), HostL10n.T("备份", "Back Up"), HostL10n.T("放弃", "Discard")))
                        if (BackupDraft(draft)) break;
                }
            }
            serviceRecovering = false;
            await InitializeWebAsync();
        }
        finally { serviceRecovering = false; }
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
        // 从托盘打开最小化的窗口时恢复到最小化前的状态（普通或最大化）。
        if (WindowState == WindowState.Minimized) SystemCommands.RestoreWindow(this);
        FitWindowToScreen();
        Activate();
    }
    private void FitWindowToScreen()
    {
        var handle = new WindowInteropHelper(this).Handle;
        var screen = Forms.Screen.FromHandle(handle);
        var area = screen.WorkingArea;
        double scale = GetDpiForWindow(handle) / 96.0;
        MinWidth = Math.Min(960, area.Width / scale);
        MinHeight = Math.Min(640, area.Height / scale);
        var placement = WindowPlacement.Capture(handle);
        // 工作区坐标扣除了屏幕顶部、左侧任务栏的偏移。
        placement.Fit(screen.Bounds.Left, screen.Bounds.Top, area.Width, area.Height);
        placement.Apply(handle);
    }
    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr handle);
    // 新实例带 --relaunch 启动，会等待当前实例释放单实例锁后再打开。
    private void Relaunch()
    {
        try
        {
            var start = new ProcessStartInfo(Environment.ProcessPath ?? throw new InvalidOperationException(HostL10n.T("无法定位应用程序。", "Couldn't locate the application."))) { UseShellExecute = false };
            start.ArgumentList.Add(App.RelaunchArgument);
            Process.Start(start);
            HostLog.Write(service.Root, "restart.launched");
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            HostLog.Write(service.Root, "restart.failed", error);
            AppDialog.Show(this, HostL10n.T("未能自动重新打开", "Couldn't Reopen Automatically"), HostL10n.T("数据已迁移完成，请手动打开 yovoice。", "Your data has been moved. Please open yovoice manually."));
        }
    }
    public void RequestExit()
    {
        if (shuttingDown) return;
        RestoreWindow();
        exitRequested = true;
        Close();
    }
    // 菜单“检查更新”在界面内打开更新详情；界面尚未就绪时返回 false，由更新器弹原生对话框。
    private bool ShowUpdateInApp()
    {
        if (web?.CoreWebView2 is null || recovering || shuttingDown) return false;
        RestoreWindow();
        try { _ = web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('workbench-show-update'))"); return true; }
        catch (InvalidOperationException) { return false; }
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
    // 标题栏里的 Ocho：把帧序列切成单帧，以 10 帧/秒循环播放；系统关闭动画时停在第一帧。
    private void AnimateGhost()
    {
        var strip = new System.Windows.Media.Imaging.BitmapImage(new Uri("pack://application:,,,/Resources/ocho-ghost.png"));
        int side = strip.PixelHeight;
        var frames = Enumerable.Range(0, strip.PixelWidth / side)
            .Select(index => (System.Windows.Media.ImageSource)new System.Windows.Media.Imaging.CroppedBitmap(strip, new Int32Rect(index * side, 0, side, side)))
            .ToArray();
        if (frames.Length == 0) return;
        OchoGhost.Source = frames[0];
        if (frames.Length == 1 || !SystemParameters.ClientAreaAnimation) return;
        int current = 0;
        var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        timer.Tick += (_, _) => { current = (current + 1) % frames.Length; OchoGhost.Source = frames[current]; };
        timer.Start();
    }

    private async void ToggleAssistant_Click(object sender, RoutedEventArgs e)
    {
        if (web?.CoreWebView2 is null || recovering || shuttingDown) return;
        try { await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('workbench-toggle-assistant'))"); }
        catch (InvalidOperationException) { }
        catch (TaskCanceledException) { }
    }

    private async void ToggleInspector_Click(object sender, RoutedEventArgs e)
    {
        if (web?.CoreWebView2 is null || recovering || shuttingDown) return;
        try { await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('workbench-toggle-inspector'))"); }
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
            web = new WebView2CompositionControl { DefaultBackgroundColor = System.Drawing.Color.FromArgb(247, 247, 247) }; Container.Children.Add(web); SyncWebVisibility();
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
            if (!File.Exists(Path.Combine(assets, "index.html"))) throw new IOException(HostL10n.T("界面文件缺失，请运行构建脚本或重新安装应用。", "Interface files are missing. Run the build script or reinstall the app."));
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
            panel.Children.Add(new System.Windows.Controls.TextBlock { Text = HostL10n.T("界面无法打开。请确认已安装 Microsoft WebView2 Runtime。\n", "The interface couldn't open. Make sure Microsoft WebView2 Runtime is installed.\n") + error.Message, TextWrapping = TextWrapping.Wrap });
            var retry = new System.Windows.Controls.Button { Content = HostL10n.T("重试", "Try Again"), Margin = new Thickness(0, 20, 0, 0) };
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
            if (raw.Length > 28 * 1024 * 1024) throw new ArgumentException(HostL10n.T("请求体积超出限制。", "The request is too large."));
            using var doc = JsonDocument.Parse(raw);
            var message = doc.RootElement;
            id = message.GetProperty("id").GetString();
            method = message.GetProperty("method").GetString()!;
            var data = message.GetProperty("data");
            object? result;
            switch (method)
            {
                case "inspector.available":
                    // 只有工作区有右侧面板，离开工作区时隐藏标题栏开关并禁用菜单项。
                    bool available = data.GetProperty("available").GetBoolean();
                    ToggleInspectorButton.Visibility = available ? Visibility.Visible : Visibility.Collapsed;
                    ToggleInspectorMenu.IsEnabled = available; result = true; break;
                case "window.immersive":
                    // macOS 播放页把网页铺进标题栏；Windows 的标题栏放着菜单，保持原样。
                    result = true; break;
                case "assistant.entry":
                    // 网页右下角入口在时不重复显示标题栏入口，移走后才由标题栏接替。
                    ToggleAssistantButton.Visibility = data.GetProperty("visible").GetBoolean() ? Visibility.Visible : Visibility.Collapsed;
                    result = true; break;
                case "sidebar.save":
                    double size = data.GetProperty("size").GetDouble();
                    bool collapsed = data.GetProperty("isCollapsed").GetBoolean();
                    if (!double.IsFinite(size) || size < 180 || size > 360) throw new ArgumentException(HostL10n.T("侧栏设置无效。", "Invalid sidebar settings."));
                    string sidebarPath = Path.Combine(service.Root, "sidebar.json");
                    File.WriteAllText(sidebarPath + ".tmp", JsonSerializer.Serialize(new { size, isCollapsed = collapsed }));
                    File.Move(sidebarPath + ".tmp", sidebarPath, true); result = true; break;
                case "project.export":
                    var projectSave = new SaveFileDialog { Filter = HostL10n.T("Yovoice 工程", "Yovoice Project") + "|*.yovoice", DefaultExt = ".yovoice", FileName = Path.GetFileName(data.GetProperty("name").GetString() ?? "project"), OverwritePrompt = true };
                    result = projectSave.ShowDialog(this) == true ? await service.CallAsync(method, new { id = data.GetProperty("id").GetString(), path = projectSave.FileName }) : false; break;
                case "logs.export":
                    // 诊断包由本地服务打包写入，宿主只负责选择保存位置。
                    var logsSave = new SaveFileDialog { Filter = HostL10n.T("诊断包", "Diagnostics") + "|*.zip", DefaultExt = ".zip", FileName = "yovoice-diagnostics-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".zip", OverwritePrompt = true };
                    result = logsSave.ShowDialog(this) == true ? await service.CallAsync(method, new { path = logsSave.FileName, version = data.TryGetProperty("version", out var logsVersion) ? logsVersion.GetString() : "" }) : false; break;
                case "project.import":
                    var projectOpen = new OpenFileDialog { Filter = HostL10n.T("Yovoice 工程", "Yovoice Project") + "|*.yovoice" };
                    result = projectOpen.ShowDialog(this) == true ? await service.CallAsync(method, new { path = projectOpen.FileName }) : null; break;
                case "score.import":
                    var scoreOpen = new OpenFileDialog { Filter = HostL10n.T("MIDI 或乐谱", "MIDI or Score") + "|*.mid;*.midi;*.json" };
                    result = scoreOpen.ShowDialog(this) == true ? await service.CallAsync(method, new { path = scoreOpen.FileName }) : null; break;
                case "score.export":
                    // 编曲导出 MIDI 或乐谱 JSON，扩展名由界面指定，写文件交给本地服务。
                    string scoreFormat = data.TryGetProperty("format", out var formatValue) && formatValue.GetString() == "json" ? "json" : "mid";
                    var scoreSave = new SaveFileDialog { Filter = scoreFormat == "json" ? HostL10n.T("乐谱 JSON", "Score JSON") + "|*.json" : "MIDI|*.mid", DefaultExt = "." + scoreFormat, FileName = Path.GetFileName(data.GetProperty("name").GetString() ?? "score") + "." + scoreFormat, OverwritePrompt = true };
                    result = scoreSave.ShowDialog(this) == true ? await service.CallAsync(method, new { path = scoreSave.FileName, score = data.GetProperty("score") }) : false; break;
                case "audio.export":
                    // 时间线合成的音频已由网页上传到本地服务的临时文件，这里只选位置并复制，用完即删。
                    string exported = (await service.CallAsync("export.path", new { id = data.GetProperty("id").GetString() })).GetString()!;
                    try
                    {
                        var save = new SaveFileDialog { Filter = HostL10n.T("WAV 音频", "WAV Audio") + "|*.wav", DefaultExt = ".wav", FileName = Path.GetFileName(data.GetProperty("name").GetString() ?? "yovoice.wav"), OverwritePrompt = true };
                        if (save.ShowDialog(this) != true) { result = false; break; }
                        string temporary = save.FileName + "." + Guid.NewGuid().ToString("N") + ".tmp";
                        try { await Task.Run(() => File.Copy(exported, temporary)); File.Move(temporary, save.FileName, true); }
                        finally { if (File.Exists(temporary)) File.Delete(temporary); }
                        result = true;
                    }
                    finally { try { File.Delete(exported); } catch (IOException) { } }
                    break;
                case "text.export":
                    // 字幕（SRT/VTT）、歌词（LRC）与旋律谱（ABC）是界面生成的 UTF-8 文本，宿主只负责选位置并写文件。
                    string textFormat = data.TryGetProperty("format", out var textFormatValue) ? textFormatValue.GetString() ?? "" : "";
                    string text = data.TryGetProperty("text", out var textValue) ? textValue.GetString() ?? "" : "";
                    if (textFormat is not ("srt" or "vtt" or "lrc" or "abc") || text.Length > 20_000_000) throw new ArgumentException(HostL10n.T("导出文件格式无效。", "The exported file format is invalid."));
                    string textFilter = textFormat switch { "srt" => HostL10n.T("SRT 字幕", "SRT Subtitles"), "vtt" => HostL10n.T("WebVTT 字幕", "WebVTT Subtitles"), "abc" => HostL10n.T("ABC 旋律谱", "ABC Melody Score"), _ => HostL10n.T("LRC 歌词", "LRC Lyrics") };
                    var textSave = new SaveFileDialog { Filter = textFilter + "|*." + textFormat, DefaultExt = "." + textFormat, FileName = Path.GetFileName(data.GetProperty("name").GetString() ?? "yovoice." + textFormat), OverwritePrompt = true };
                    if (textSave.ShowDialog(this) != true) { result = false; break; }
                    string textTemporary = textSave.FileName + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    // 不写 BOM，与 macOS 输出一致；常见播放器和剪辑软件都按 UTF-8 读取。
                    try { await File.WriteAllTextAsync(textTemporary, text, new System.Text.UTF8Encoding(false)); File.Move(textTemporary, textSave.FileName, true); }
                    finally { if (File.Exists(textTemporary)) File.Delete(textTemporary); }
                    result = true; break;
                case "output.export":
                    // 已生成的版本直接复制 outputs 中的文件，不经网页传音频字节，长歌也不受消息大小限制。
                    string source = (await service.CallAsync("media.path", new { kind = "outputs", id = data.GetProperty("id").GetString() })).GetString()!;
                    if (!File.Exists(source)) throw new FileNotFoundException(HostL10n.T("音频文件不存在。", "The audio file doesn't exist."));
                    var outputSave = new SaveFileDialog { Filter = HostL10n.T("WAV 音频", "WAV Audio") + "|*.wav", DefaultExt = ".wav", FileName = Path.GetFileName(data.GetProperty("name").GetString() ?? "yovoice.wav"), OverwritePrompt = true };
                    if (outputSave.ShowDialog(this) != true) { result = false; break; }
                    string outputTemporary = outputSave.FileName + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    try { await Task.Run(() => File.Copy(source, outputTemporary)); File.Move(outputTemporary, outputSave.FileName, true); }
                    finally { if (File.Exists(outputTemporary)) File.Delete(outputTemporary); }
                    result = true; break;
                case "media.reveal":
                    var location = await service.CallAsync("media.path", data);
                    string path = location.GetString()!;
                    if (!File.Exists(path)) throw new FileNotFoundException(HostL10n.T("音频文件不存在。", "The audio file doesn't exist."));
                    var explorer = new ProcessStartInfo("explorer.exe");
                    explorer.ArgumentList.Add("/select,"); explorer.ArgumentList.Add(path);
                    Process.Start(explorer); result = true; break;
                case "model.directory":
                    var folder = new OpenFolderDialog { Title = HostL10n.T("选择模型目录", "Choose Model Folder") };
                    result = folder.ShowDialog(this) == true ? await service.CallAsync(method, new { path = folder.FolderName }) : null; break;
                case "model.directory.open":
                    var state = (await service.CallAsync("state.get", new { })).GetProperty("state");
                    string modelDirectory = state.GetProperty("preferences").GetProperty("modelDirectory").GetString() ?? Path.Combine(service.Root, "models");
                    Directory.CreateDirectory(modelDirectory);
                    Process.Start(new ProcessStartInfo(modelDirectory) { UseShellExecute = true }); result = true; break;
                case "storage.directory":
                    var storageFolder = new OpenFolderDialog { Title = HostL10n.T("选择数据存储目录", "Choose Data Storage Folder") };
                    string? chosenStorage = storageFolder.ShowDialog(this) == true ? storageFolder.FolderName : null;
                    if (chosenStorage is null) { result = null; break; }
                    // 迁移以服务端当前状态为准，先保存界面里尚在防抖窗口内的正文，避免迁移后丢字。
                    if (web?.CoreWebView2 is not null)
                    {
                        string draftJson = await web.CoreWebView2.ExecuteScriptAsync("window.__workbenchDraft ?? null");
                        if (draftJson != "null") await service.CallAsync("draft.save", JsonSerializer.Deserialize<JsonElement>(draftJson));
                    }
                    // 跨盘复制模型可能远超 120 秒；超时后服务端仍会完成迁移并冻结旧目录，宿主却不会提示重启。
                    result = await service.CallAsync("storage.relocate", new { path = chosenStorage }, TimeSpan.FromHours(24));
                    storageRelocated = true;
                    HostLog.Write(service.Root, "storage.relocated");
                    break;
                case "storage.directory.open":
                    Directory.CreateDirectory(service.Root);
                    Process.Start(new ProcessStartInfo(service.Root) { UseShellExecute = true }); result = true; break;
                case "app.update.get":
                    result = JsonSerializer.SerializeToElement(updater.Snapshot, WebJson); break;
                case "app.update.check":
                    _ = updater.CheckFromAppAsync(); result = true; break;
                case "app.update.install":
                    result = updater.Install(); break;
                case "logs.open":
                    Process.Start(new ProcessStartInfo(Path.Combine(service.Root, "logs")) { UseShellExecute = true }); result = true; break;
                case "preferences.save":
                    result = await service.CallAsync(method, data);
                    // 设置保存成功后原生界面随之切换语言。
                    if (data.TryGetProperty("uiLocale", out var uiLocale) && uiLocale.ValueKind == JsonValueKind.String) HostL10n.Apply(uiLocale.GetString());
                    break;
                default: result = await service.CallAsync(method, data); break;
            }
            Post(new { id, result });
            if (method == "storage.directory" && storageRelocated && !shuttingDown)
            {
                AppDialog.Show(this, HostL10n.T("数据迁移完成", "Data Moved"), HostL10n.T("数据已复制到新目录，yovoice 将自动重启以使用新目录；旧目录会在重启后自动删除。", "Your data has been copied to the new folder. yovoice will restart to use it; the old folder will be removed after restart."), HostL10n.T("立即重启", "Restart Now"));
                restartRequested = true;
                RequestExit();
            }
        }
        catch (ServiceCallException error) { HostLog.Write(service.Root, "rpc.failed:" + method, error); Post(new { id, error = error.Wire }); }
        catch (Exception error) { HostLog.Write(service.Root, "bridge.failed:" + method, error); Post(new { id, error = error.Message }); }
    }
    // 更新状态按网页约定使用驼峰字段名。
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);
    private void Post(object value) => PostJson(JsonSerializer.Serialize(value));
    private void PostJson(string json)
    {
        if (closed || web?.CoreWebView2 is null) return;
        try { web.CoreWebView2.PostWebMessageAsJson(json); }
        catch (Exception error) when (error is InvalidOperationException or COMException or ArgumentException) { HostLog.Write(service.Root, "web.post_failed", error); }
    }
}
