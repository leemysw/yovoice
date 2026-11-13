import React from 'react';
import { createRoot } from 'react-dom/client';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import { App } from './app/app';
import { ThemeRoot } from './app/theme-root';
import './shared/theme/yovoice-paper.css';
import './shared/theme/yovoice-ink.css';
import './shared/theme/yovoice-lagoon.css';
import './shared/theme/yovoice-sand.css';
import './shared/theme/yovoice-sage.css';
import './shared/theme/yovoice-abyss.css';
import './app/styles.css';
import { reportDesktop } from './shared/lib/bridge';
import { RootBoundary } from './shared/ui/page-boundary';
import { dismissSplash } from './shared/lib/splash';

// 未捕获的界面错误写入服务日志，排查问题时与服务端事件放在一起看；同时收起启动动画，免得挡住出错的界面。
window.addEventListener('error', event => {
  dismissSplash(true);
  reportDesktop('error', '', `${event.message} @ ${event.filename}:${event.lineno}`);
});
window.addEventListener('unhandledrejection', event => {
  dismissSplash(true);
  reportDesktop('rejection', '', String((event.reason as Error)?.stack ?? event.reason));
});
// 标记 Windows：部分样式（如滚动边缘渐隐）在 WebView2/Chrome 的 Windows 合成器上会渲染出错，需要按系统区分。
if (/Windows/.test(navigator.userAgent)) document.documentElement.dataset.os = 'windows';
createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeRoot><RootBoundary><App /></RootBoundary></ThemeRoot></React.StrictMode>);
