import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { CircleAlert } from 'lucide-react';
import { isDesktop, reportDesktop } from '../lib/bridge';
import { dismissSplash } from '../lib/splash';
import { call } from '../lib/client';
import { resolveInitialUiLocale } from '../i18n/locale';

// 补存最多等这么久（毫秒）：服务没有回应时也要能重新加载。
const saveTimeout = 3000;

// 重新加载前先补存未落盘的修改，否则防抖中的输入会随页面一起丢失；保存卡住时不让重新加载也跟着卡住。
async function reload() {
  const pending = window.__workbenchDraft;
  if (pending) await Promise.race([call('draft.save', pending).catch(() => undefined), new Promise(resolve => setTimeout(resolve, saveTimeout))]);
  window.location.reload();
}

// 按需加载的代码块没取到（网络中断，或更新后旧版本的文件已不存在）：React.lazy 会记住失败结果，
// 原地重试只会再抛同一个错误，只能重新加载页面。各浏览器的报错文案不同，按关键词识别。
export function isChunkLoadError(error: Error): boolean {
  return error.name === 'ChunkLoadError' || /dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk/i.test(error.message);
}

type Labels = { title: string; body: string; retry: string; reload: string };
type BoundaryProps = { name: string; resetKey?: string; labels: () => Labels; children: ReactNode };
type BoundaryState = { error: Error | null; resetKey?: string };

// 界面渲染异常只影响出错的区域：其余页面和导航照常可用，异常写入服务日志便于排查。
// resetKey 变化（如切换作品）时自动重试，用户也可以手动重试或重新加载窗口。
class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, resetKey: this.props.resetKey };
  static getDerivedStateFromError(error: Error): Partial<BoundaryState> { return { error }; }
  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    dismissSplash(true);
    const detail = `${error.stack ?? String(error)}\n${info.componentStack ?? ''}`;
    // 桌面端写入服务日志；浏览器预览没有宿主，打到控制台便于排查。
    if (isDesktop) reportDesktop('render', this.props.name, detail); else console.error(`[${this.props.name}]`, detail);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const labels = this.props.labels();
    const chunk = isChunkLoadError(this.state.error);
    return <VStack className="page-error" role="alert" gap={3} hAlign="center" vAlign="center" data-chunk={chunk || undefined}>
      <CircleAlert className="notice-icon" aria-hidden />
      <strong>{labels.title}</strong>
      <p>{labels.body}</p>
      <HStack gap={2}>
        <Button size="sm" label={labels.retry} onClick={() => { if (chunk) void reload(); else this.setState({ error: null }); }} />
        <Button size="sm" variant="primary" label={labels.reload} onClick={() => void reload()} />
      </HStack>
    </VStack>;
  }
}

export function PageBoundary({ name, resetKey, children }: { name: string; resetKey?: string; children: ReactNode }) {
  const t = useTranslator();
  return <Boundary name={name} resetKey={resetKey} labels={() => ({ title: t('@yovoice.app.pageError.title'), body: t('@yovoice.app.pageError.body'), retry: t('@yovoice.app.pageError.retry'), reload: t('@yovoice.app.pageError.reload') })}>{children}</Boundary>;
}

// 最外层兜底：语言目录尚未加载时也能展示，中文系统显示中文，其余显示英文。
export function RootBoundary({ children }: { children: ReactNode }) {
  const zh = resolveInitialUiLocale(navigator.language).startsWith('zh');
  const labels = (): Labels => zh
    ? { title: '界面出错了', body: '出错原因已记录到日志。可以重试，或重新加载窗口（会先保存未保存的修改）。', retry: '重试', reload: '重新加载' }
    : { title: 'Something went wrong', body: 'The error has been logged. Try again or reload the window (unsaved edits are saved first).', retry: 'Try again', reload: 'Reload' };
  return <Boundary name="root" labels={labels}>{children}</Boundary>;
}
