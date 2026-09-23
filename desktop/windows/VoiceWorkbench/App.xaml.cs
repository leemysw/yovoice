using System.Threading;
using System.Windows;

namespace VoiceWorkbench.Desktop;
public partial class App : Application
{
    private Mutex? instance;
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        instance = new Mutex(true, "Local\\VoiceWorkbench.Desktop", out bool created);
        if (!created) { AppDialog.Show(null, "yovoice 已在运行", "请点击系统托盘中的 yovoice 图标打开窗口。"); Shutdown(); return; }
        try { new MainWindow().Show(); }
        catch (Exception error) { AppDialog.Show(null, "无法启动 yovoice", error.Message); Shutdown(1); }
    }
    protected override void OnExit(ExitEventArgs e) { instance?.Dispose(); base.OnExit(e); }
}
