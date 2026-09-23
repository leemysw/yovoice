using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace VoiceWorkbench.Desktop;

public partial class AppDialog : Window
{
    private AppDialog(Window? owner, string title, string message, string confirm, string? cancel)
    {
        InitializeComponent();
        Title = title; Heading.Text = title; Message.Text = message;
        ConfirmAction.Content = confirm;
        if (owner is { IsVisible: true }) Owner = owner;
        else WindowStartupLocation = WindowStartupLocation.CenterScreen;
        CancelAction.Content = cancel;
        CancelAction.Visibility = cancel is null ? Visibility.Collapsed : Visibility.Visible;
        // 确认操作默认聚焦取消，避免回车误触发安装或退出。
        ConfirmAction.IsDefault = cancel is null;
        CancelAction.IsDefault = cancel is not null;
        Loaded += (_, _) => { if (cancel is null) ConfirmAction.Focus(); else CancelAction.Focus(); };
        PreviewKeyDown += (_, e) =>
        {
            if (e.Key != System.Windows.Input.Key.Escape) return;
            e.Handled = true;
            DialogResult = false;
        };
        SourceInitialized += (_, _) =>
        {
            int corners = 2;
            _ = DwmSetWindowAttribute(new WindowInteropHelper(this).Handle, 33, ref corners, sizeof(int));
        };
    }

    public static bool Show(Window? owner, string title, string message, string confirm = "知道了", string? cancel = null)
        => new AppDialog(owner, title, message, confirm, cancel).ShowDialog() == true;

    private void Confirm_Click(object sender, RoutedEventArgs e) => DialogResult = true;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);
}
