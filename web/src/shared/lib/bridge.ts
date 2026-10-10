import type { Draft, State } from '../workbench';
import { CallError, parseCallError } from './call-error';

declare global { interface Window { __workbenchPlatform?: 'macos'; __workbenchMediaBase?: string; __workbenchDraft?: Draft; chrome?: { webview?: { postMessage: (data: unknown) => void; addEventListener: (name: string, listener: (event: MessageEvent) => void) => void } } } }

// 桌面宿主（WebView2 / WKWebView）注入的消息通道；浏览器预览中不存在。
const native = window.chrome?.webview;
export const isDesktop = !!native;
export const isMac = window.__workbenchPlatform === 'macos';

const listeners = new Set<(state: State) => void>();
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
native?.addEventListener('message', ({ data }) => {
  if (data.event === 'state') { listeners.forEach(fn => fn(data.state)); return; }
  const callback = pending.get(data.id);
  if (!callback) return;
  clearTimeout(callback.timer); pending.delete(data.id);
  if (data.error) callback.reject(parseCallError(data.error)); else callback.resolve(data.result);
});

export function subscribeDesktop(listener: (state: State) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function desktopCall<T>(method: string, data: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new CallError('@yovoice.error.unknown', { detail: 'desktop timeout' })); }, 120000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer }); native!.postMessage({ id, method, data });
  });
}

export function desktopMediaUrl(kind: 'voices' | 'outputs', file: string): string {
  const base = window.__workbenchMediaBase;
  return base ? `${base}${kind}/${encodeURIComponent(file)}` : `https://${kind}.workbench.local/${encodeURIComponent(file)}`;
}
