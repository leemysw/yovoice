package main

import (
	"fmt"
	"strings"
	"unsafe"

	"github.com/ebitengine/purego"
)

// 运行时用 purego 加载 GTK 3 与 WebKitGTK，不依赖 cgo：在 CI 的 Ubuntu 上即可交叉编译，
// 用户机器上缺少 WebKitGTK 时给出安装提示而不是启动即崩溃。优先 4.1（libsoup 3），回退 4.0。
var (
	gFree                                             func(p uintptr)
	gIdleAddFull                                      func(priority int32, fn, data, notify uintptr) uint32
	gTimeoutAdd                                       func(ms uint32, fn, data uintptr) uint32
	gSignalConnectData                                func(instance uintptr, signal string, handler, data, destroy uintptr, flags int32) uint64
	gObjectUnref                                      func(obj uintptr)
	gTypeCheckInstanceIsA                             func(instance, gtype uintptr) bool
	gSetPrgname                                       func(name string)
	gMarkupEscapeText                                 func(text string, length int) uintptr
	gtkInitCheck                                      func(argc, argv uintptr) bool
	gtkMain                                           func()
	gtkMainQuit                                       func()
	gtkWindowNew                                      func(kind int32) uintptr
	gtkWindowSetTitle                                 func(window uintptr, title string)
	gtkWindowSetDefaultSize                           func(window uintptr, width, height int32)
	gtkWindowSetIconFromFile                          func(window uintptr, path string, err uintptr) bool
	gtkWindowSetTitlebar                              func(window, titlebar uintptr)
	gtkWindowPresent                                  func(window uintptr)
	gtkWindowMaximize                                 func(window uintptr)
	gtkWindowIsMaximized                              func(window uintptr) bool
	gtkWindowGetSize                                  func(window uintptr, width, height *int32)
	gtkWindowSetTransientFor                          func(window, parent uintptr)
	gtkHeaderBarNew                                   func() uintptr
	gtkHeaderBarSetTitle                              func(bar uintptr, title string)
	gtkHeaderBarSetShowCloseButton                    func(bar uintptr, show bool)
	gtkHeaderBarPackStart                             func(bar, child uintptr)
	gtkHeaderBarPackEnd                               func(bar, child uintptr)
	gtkButtonNewFromIconName                          func(name string, size int32) uintptr
	gtkButtonNew                                      func() uintptr
	gtkButtonSetImage                                 func(button, image uintptr)
	gtkButtonSetRelief                                func(button uintptr, relief int32)
	gtkImageNew                                       func() uintptr
	gtkImageSetFromPixbuf                             func(image, pixbuf uintptr)
	gtkLabelNew                                       func(text string) uintptr
	gtkLabelSetText                                   func(label uintptr, text string)
	gtkLabelSetLineWrap                               func(label uintptr, wrap bool)
	gtkBoxNew                                         func(orientation, spacing int32) uintptr
	gtkBoxPackStart                                   func(box, child uintptr, expand, fill bool, padding uint32)
	gtkContainerAdd                                   func(container, child uintptr)
	gtkContainerRemove                                func(container, child uintptr)
	gtkWidgetShowAll                                  func(widget uintptr)
	gtkWidgetDestroy                                  func(widget uintptr)
	gtkWidgetSetVisible                               func(widget uintptr, visible bool)
	gtkWidgetSetSensitive                             func(widget uintptr, sensitive bool)
	gtkWidgetSetTooltipText                           func(widget uintptr, text string)
	gtkWidgetSetSizeRequest                           func(widget uintptr, width, height int32)
	gtkWidgetSetHalign                                func(widget uintptr, align int32)
	gtkWidgetGetStyleContext                          func(widget uintptr) uintptr
	gtkStyleContextAddClass                           func(context uintptr, class string)
	gtkStyleContextAddProviderForScreen               func(screen, provider uintptr, priority uint32)
	gtkCssProviderNew                                 func() uintptr
	gtkCssProviderLoadFromData                        func(provider uintptr, data string, length int, err uintptr) bool
	gdkScreenGetDefault                               func() uintptr
	gtkWidgetSetValign                                func(widget uintptr, align int32)
	gtkWidgetGrabFocus                                func(widget uintptr)
	gtkMessageDialogNew                               func(parent uintptr, flags, kind, buttons int32, format, text string) uintptr
	gtkMessageDialogFormatSecondaryText               func(dialog uintptr, format, text string)
	gtkDialogAddButton                                func(dialog uintptr, label string, response int32) uintptr
	gtkDialogSetDefaultResponse                       func(dialog uintptr, response int32)
	gtkDialogRun                                      func(dialog uintptr) int32
	gtkFileChooserNativeNew                           func(title string, parent uintptr, action int32, accept, cancel string) uintptr
	gtkNativeDialogRun                                func(dialog uintptr) int32
	gtkFileChooserSetDoOverwriteConfirm               func(chooser uintptr, confirm bool)
	gtkFileChooserSetCurrentName                      func(chooser uintptr, name string)
	gtkFileChooserGetFilename                         func(chooser uintptr) uintptr
	gtkFileChooserAddFilter                           func(chooser, filter uintptr)
	gtkFileFilterNew                                  func() uintptr
	gtkFileFilterSetName                              func(filter uintptr, name string)
	gtkFileFilterAddPattern                           func(filter uintptr, pattern string)
	gdkPixbufNewFromFile                              func(path string, err uintptr) uintptr
	gdkPixbufNewSubpixbuf                             func(src uintptr, x, y, width, height int32) uintptr
	gdkPixbufScaleSimple                              func(src uintptr, width, height, interp int32) uintptr
	gdkPixbufGetWidth                                 func(pixbuf uintptr) int32
	gdkPixbufGetHeight                                func(pixbuf uintptr) int32
	webkitUserContentManagerNew                       func() uintptr
	webkitUserContentManagerRegisterHandler           func(manager uintptr, name string) bool
	webkitUserContentManagerAddScript                 func(manager, script uintptr)
	webkitUserScriptNew                               func(source string, frames, time int32, allow, block uintptr) uintptr
	webkitUserScriptUnref                             func(script uintptr)
	webkitWebViewNewWithUserContentManager            func(manager uintptr) uintptr
	webkitWebViewGetContext                           func(view uintptr) uintptr
	webkitWebViewGetSettings                          func(view uintptr) uintptr
	webkitWebViewLoadURI                              func(view uintptr, uri string)
	webkitWebViewReload                               func(view uintptr)
	webkitWebViewGetURI                               func(view uintptr) string
	webkitWebViewRunJavascript                        func(view uintptr, script string, cancellable, callback, data uintptr)
	webkitWebViewEvaluateJavascript                   func(view uintptr, script string, length int, world, source, cancellable, callback, data uintptr)
	webkitWebViewSetBackgroundColor                   func(view uintptr, color *[4]float64)
	webkitWebContextGetCookieManager                  func(context uintptr) uintptr
	webkitWebContextGetDefault                        func() uintptr
	webkitWebContextSetPreferredLanguages             func(context uintptr, languages *uintptr)
	webkitCookieManagerAddCookie                      func(manager, cookie, cancellable, callback, data uintptr)
	webkitSettingsSetEnableDeveloperExtras            func(settings uintptr, enable bool)
	webkitSettingsSetEnableMediaStream                func(settings uintptr, enable bool)
	webkitSettingsSetMediaPlaybackRequiresUserGesture func(settings uintptr, required bool)
	disableBrokenAnchorPositioning                    func(settings uintptr)
	webkitJavascriptResultGetJSValue                  func(result uintptr) uintptr
	jscValueToString                                  func(value uintptr) uintptr
	webkitNavigationPolicyDecisionGetNavigationAction func(decision uintptr) uintptr
	webkitNavigationActionGetRequest                  func(action uintptr) uintptr
	webkitNavigationActionIsUserGesture               func(action uintptr) bool
	webkitURIRequestGetURI                            func(request uintptr) string
	webkitPolicyDecisionUse                           func(decision uintptr)
	webkitPolicyDecisionIgnore                        func(decision uintptr)
	webkitUserMediaPermissionRequestGetType           func() uintptr
	webkitUserMediaPermissionIsForAudioDevice         func(request uintptr) bool
	webkitUserMediaPermissionIsForVideoDevice         func(request uintptr) bool
	webkitPermissionRequestAllow                      func(request uintptr)
	webkitPermissionRequestDeny                       func(request uintptr)
	soupCookieNew                                     func(name, value, domain, path string, maxAge int32) uintptr
	soupCookieSetHTTPOnly                             func(cookie uintptr, httpOnly bool)
	soupCookieFree                                    func(cookie uintptr)
)

func open(names ...string) (uintptr, error) {
	var failures []string
	for _, name := range names {
		handle, err := purego.Dlopen(name, purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if err == nil {
			return handle, nil
		}
		failures = append(failures, err.Error())
	}
	return 0, fmt.Errorf("%s: %s", names[0], strings.Join(failures, "; "))
}

// bind 登记一个函数；缺少符号时保持 nil，由调用处选择替代实现。
func bind(library uintptr, fn any, name string) bool {
	symbol, err := purego.Dlsym(library, name)
	if err != nil || symbol == 0 {
		return false
	}
	purego.RegisterFunc(fn, symbol)
	return true
}

type binding struct {
	fn   any
	name string
}

func bindAll(library uintptr, list []binding) error {
	for _, b := range list {
		if !bind(library, b.fn, b.name) {
			return fmt.Errorf("missing symbol %s", b.name)
		}
	}
	return nil
}

// loadLibraries 打开 GTK 与 WebKitGTK；失败时返回可展示给用户的安装提示。
func loadLibraries() error {
	glib, err := open("libglib-2.0.so.0")
	if err != nil {
		return err
	}
	gobject, err := open("libgobject-2.0.so.0")
	if err != nil {
		return err
	}
	gtk, err := open("libgtk-3.so.0")
	if err != nil {
		return fmt.Errorf("%w\n%s", err, T("请安装 GTK 3。", "Install GTK 3."))
	}
	pixbuf, err := open("libgdk_pixbuf-2.0.so.0")
	if err != nil {
		return err
	}
	// 4.1 搭配 libsoup 3 与 JavaScriptCore 4.1，4.0 搭配 libsoup 2.4；两套不能混用。
	jscName, soupName := "libjavascriptcoregtk-4.1.so.0", "libsoup-3.0.so.0"
	webkit, err := open("libwebkit2gtk-4.1.so.0")
	if err != nil {
		jscName, soupName = "libjavascriptcoregtk-4.0.so.18", "libsoup-2.4.so.1"
		if webkit, err = open("libwebkit2gtk-4.0.so.37"); err != nil {
			return fmt.Errorf("%w\n%s", err, T("请先安装 WebKitGTK：Debian/Ubuntu 运行 sudo apt install libwebkit2gtk-4.1-0，Fedora 运行 sudo dnf install webkit2gtk4.1。", "Install WebKitGTK first: sudo apt install libwebkit2gtk-4.1-0 on Debian/Ubuntu, sudo dnf install webkit2gtk4.1 on Fedora."))
		}
	}
	jsc, err := open(jscName)
	if err != nil {
		return err
	}
	soup, err := open(soupName)
	if err != nil {
		return err
	}
	if err = bindAll(glib, []binding{
		{&gFree, "g_free"}, {&gIdleAddFull, "g_idle_add_full"}, {&gTimeoutAdd, "g_timeout_add"},
		{&gSetPrgname, "g_set_prgname"}, {&gMarkupEscapeText, "g_markup_escape_text"},
	}); err != nil {
		return err
	}
	if err = bindAll(gobject, []binding{
		{&gSignalConnectData, "g_signal_connect_data"}, {&gObjectUnref, "g_object_unref"},
		{&gTypeCheckInstanceIsA, "g_type_check_instance_is_a"},
	}); err != nil {
		return err
	}
	if err = bindAll(gtk, []binding{
		{&gtkInitCheck, "gtk_init_check"}, {&gtkMain, "gtk_main"}, {&gtkMainQuit, "gtk_main_quit"},
		{&gtkWindowNew, "gtk_window_new"}, {&gtkWindowSetTitle, "gtk_window_set_title"},
		{&gtkWindowSetDefaultSize, "gtk_window_set_default_size"}, {&gtkWindowSetIconFromFile, "gtk_window_set_icon_from_file"},
		{&gtkWindowSetTitlebar, "gtk_window_set_titlebar"}, {&gtkWindowPresent, "gtk_window_present"},
		{&gtkWindowMaximize, "gtk_window_maximize"}, {&gtkWindowIsMaximized, "gtk_window_is_maximized"},
		{&gtkWindowGetSize, "gtk_window_get_size"}, {&gtkWindowSetTransientFor, "gtk_window_set_transient_for"},
		{&gtkHeaderBarNew, "gtk_header_bar_new"}, {&gtkHeaderBarSetTitle, "gtk_header_bar_set_title"},
		{&gtkHeaderBarSetShowCloseButton, "gtk_header_bar_set_show_close_button"},
		{&gtkHeaderBarPackStart, "gtk_header_bar_pack_start"}, {&gtkHeaderBarPackEnd, "gtk_header_bar_pack_end"},
		{&gtkButtonNewFromIconName, "gtk_button_new_from_icon_name"}, {&gtkButtonNew, "gtk_button_new"},
		{&gtkButtonSetImage, "gtk_button_set_image"}, {&gtkButtonSetRelief, "gtk_button_set_relief"},
		{&gtkImageNew, "gtk_image_new"}, {&gtkImageSetFromPixbuf, "gtk_image_set_from_pixbuf"},
		{&gtkLabelNew, "gtk_label_new"}, {&gtkLabelSetText, "gtk_label_set_text"}, {&gtkLabelSetLineWrap, "gtk_label_set_line_wrap"},
		{&gtkBoxNew, "gtk_box_new"}, {&gtkBoxPackStart, "gtk_box_pack_start"},
		{&gtkContainerAdd, "gtk_container_add"}, {&gtkContainerRemove, "gtk_container_remove"},
		{&gtkWidgetShowAll, "gtk_widget_show_all"}, {&gtkWidgetDestroy, "gtk_widget_destroy"},
		{&gtkWidgetSetVisible, "gtk_widget_set_visible"}, {&gtkWidgetSetSensitive, "gtk_widget_set_sensitive"},
		{&gtkWidgetSetTooltipText, "gtk_widget_set_tooltip_text"}, {&gtkWidgetSetSizeRequest, "gtk_widget_set_size_request"},
		{&gtkWidgetSetHalign, "gtk_widget_set_halign"}, {&gtkWidgetSetValign, "gtk_widget_set_valign"},
		{&gtkWidgetGrabFocus, "gtk_widget_grab_focus"},
		{&gtkWidgetGetStyleContext, "gtk_widget_get_style_context"}, {&gtkStyleContextAddClass, "gtk_style_context_add_class"},
		{&gtkStyleContextAddProviderForScreen, "gtk_style_context_add_provider_for_screen"},
		{&gtkCssProviderNew, "gtk_css_provider_new"}, {&gtkCssProviderLoadFromData, "gtk_css_provider_load_from_data"},
		{&gdkScreenGetDefault, "gdk_screen_get_default"},
		{&gtkMessageDialogNew, "gtk_message_dialog_new"}, {&gtkMessageDialogFormatSecondaryText, "gtk_message_dialog_format_secondary_text"},
		{&gtkDialogAddButton, "gtk_dialog_add_button"}, {&gtkDialogSetDefaultResponse, "gtk_dialog_set_default_response"},
		{&gtkDialogRun, "gtk_dialog_run"},
		{&gtkFileChooserNativeNew, "gtk_file_chooser_native_new"}, {&gtkNativeDialogRun, "gtk_native_dialog_run"},
		{&gtkFileChooserSetDoOverwriteConfirm, "gtk_file_chooser_set_do_overwrite_confirmation"},
		{&gtkFileChooserSetCurrentName, "gtk_file_chooser_set_current_name"},
		{&gtkFileChooserGetFilename, "gtk_file_chooser_get_filename"}, {&gtkFileChooserAddFilter, "gtk_file_chooser_add_filter"},
		{&gtkFileFilterNew, "gtk_file_filter_new"}, {&gtkFileFilterSetName, "gtk_file_filter_set_name"},
		{&gtkFileFilterAddPattern, "gtk_file_filter_add_pattern"},
	}); err != nil {
		return err
	}
	if err = bindAll(pixbuf, []binding{
		{&gdkPixbufNewFromFile, "gdk_pixbuf_new_from_file"}, {&gdkPixbufNewSubpixbuf, "gdk_pixbuf_new_subpixbuf"},
		{&gdkPixbufScaleSimple, "gdk_pixbuf_scale_simple"}, {&gdkPixbufGetWidth, "gdk_pixbuf_get_width"},
		{&gdkPixbufGetHeight, "gdk_pixbuf_get_height"},
	}); err != nil {
		return err
	}
	if err = bindAll(webkit, []binding{
		{&webkitUserContentManagerNew, "webkit_user_content_manager_new"},
		{&webkitUserContentManagerRegisterHandler, "webkit_user_content_manager_register_script_message_handler"},
		{&webkitUserContentManagerAddScript, "webkit_user_content_manager_add_script"},
		{&webkitUserScriptNew, "webkit_user_script_new"}, {&webkitUserScriptUnref, "webkit_user_script_unref"},
		{&webkitWebViewNewWithUserContentManager, "webkit_web_view_new_with_user_content_manager"},
		{&webkitWebViewGetContext, "webkit_web_view_get_context"}, {&webkitWebViewGetSettings, "webkit_web_view_get_settings"},
		{&webkitWebViewLoadURI, "webkit_web_view_load_uri"}, {&webkitWebViewReload, "webkit_web_view_reload"},
		{&webkitWebViewGetURI, "webkit_web_view_get_uri"}, {&webkitWebViewSetBackgroundColor, "webkit_web_view_set_background_color"},
		{&webkitWebContextGetCookieManager, "webkit_web_context_get_cookie_manager"},
		{&webkitWebContextGetDefault, "webkit_web_context_get_default"},
		{&webkitWebContextSetPreferredLanguages, "webkit_web_context_set_preferred_languages"},
		{&webkitWebContextGetDefault, "webkit_web_context_get_default"},
		{&webkitWebContextSetPreferredLanguages, "webkit_web_context_set_preferred_languages"},
		{&webkitCookieManagerAddCookie, "webkit_cookie_manager_add_cookie"},
		{&webkitSettingsSetEnableDeveloperExtras, "webkit_settings_set_enable_developer_extras"},
		{&webkitSettingsSetEnableMediaStream, "webkit_settings_set_enable_media_stream"},
		{&webkitSettingsSetMediaPlaybackRequiresUserGesture, "webkit_settings_set_media_playback_requires_user_gesture"},
		{&webkitJavascriptResultGetJSValue, "webkit_javascript_result_get_js_value"},
		{&webkitNavigationPolicyDecisionGetNavigationAction, "webkit_navigation_policy_decision_get_navigation_action"},
		{&webkitNavigationActionGetRequest, "webkit_navigation_action_get_request"},
		{&webkitNavigationActionIsUserGesture, "webkit_navigation_action_is_user_gesture"},
		{&webkitURIRequestGetURI, "webkit_uri_request_get_uri"},
		{&webkitPolicyDecisionUse, "webkit_policy_decision_use"}, {&webkitPolicyDecisionIgnore, "webkit_policy_decision_ignore"},
		{&webkitUserMediaPermissionRequestGetType, "webkit_user_media_permission_request_get_type"},
		{&webkitUserMediaPermissionIsForAudioDevice, "webkit_user_media_permission_is_for_audio_device"},
		{&webkitUserMediaPermissionIsForVideoDevice, "webkit_user_media_permission_is_for_video_device"},
		{&webkitPermissionRequestAllow, "webkit_permission_request_allow"},
		{&webkitPermissionRequestDeny, "webkit_permission_request_deny"},
	}); err != nil {
		return err
	}
	disableBrokenAnchorPositioning = webKitAnchorWorkaround(webkit)
	// 2.40 起以 evaluate_javascript 取代 run_javascript；两者至少有一个。
	bind(webkit, &webkitWebViewEvaluateJavascript, "webkit_web_view_evaluate_javascript")
	if webkitWebViewEvaluateJavascript == nil && !bind(webkit, &webkitWebViewRunJavascript, "webkit_web_view_run_javascript") {
		return fmt.Errorf("missing symbol webkit_web_view_run_javascript")
	}
	if err = bindAll(jsc, []binding{{&jscValueToString, "jsc_value_to_string"}}); err != nil {
		return err
	}
	return bindAll(soup, []binding{
		{&soupCookieNew, "soup_cookie_new"}, {&soupCookieSetHTTPOnly, "soup_cookie_set_http_only"}, {&soupCookieFree, "soup_cookie_free"},
	})
}

func webKitAnchorWorkaround(library uintptr) func(uintptr) {
	var major, minor func() uint32
	// 2.50 的 position-try 在隐藏页面子树时可能无限重算；2.52 已修复（WebKit #299742）。
	// 只在受影响的 WebKitGTK 系列禁用 CSS 锚点，让 Astryx 沿用已有的 Floating UI 定位。
	if !bind(library, &major, "webkit_get_major_version") || !bind(library, &minor, "webkit_get_minor_version") || major() != 2 || minor() != 50 {
		return nil
	}
	var getFeatures func() uintptr
	var unrefFeatures func(uintptr)
	var length func(uintptr) uintptr
	var featureAt func(list, index uintptr) uintptr
	var identifier func(uintptr) string
	var setEnabled func(settings, feature uintptr, enabled bool)
	if err := bindAll(library, []binding{
		{&getFeatures, "webkit_settings_get_all_features"},
		{&unrefFeatures, "webkit_feature_list_unref"},
		{&length, "webkit_feature_list_get_length"},
		{&featureAt, "webkit_feature_list_get"},
		{&identifier, "webkit_feature_get_identifier"},
		{&setEnabled, "webkit_settings_set_feature_enabled"},
	}); err != nil {
		return nil
	}
	return func(settings uintptr) {
		list := getFeatures()
		defer unrefFeatures(list)
		for i, n := uintptr(0), length(list); i < n; i++ {
			feature := featureAt(list, i)
			if identifier(feature) == "CSSAnchorPositioning" {
				setEnabled(settings, feature, false)
				return
			}
		}
	}
}

// goString 复制 C 字符串。
func goString(p uintptr) string {
	if p == 0 {
		return ""
	}
	base := *(*unsafe.Pointer)(unsafe.Pointer(&p))
	n := 0
	for *(*byte)(unsafe.Add(base, n)) != 0 {
		n++
	}
	return string(unsafe.Slice((*byte)(base), n))
}

// takeString 复制并释放 GLib 分配的字符串。
func takeString(p uintptr) string {
	s := goString(p)
	if p != 0 {
		gFree(p)
	}
	return s
}

// connect 连接 GObject 信号，回调由 purego.NewCallback 创建且只创建一次。
func connect(instance uintptr, signal string, callback uintptr) {
	gSignalConnectData(instance, signal, callback, 0, 0, 0)
}
