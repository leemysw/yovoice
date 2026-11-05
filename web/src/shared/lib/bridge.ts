import type { Draft, State } from '../workbench';
import { CallError, parseCallError } from './call-error';

declare global { interface Window { __workbenchPlatform?: 'macos' | 'linux'; __workbenchMediaBase?: string; __workbenchDraft?: Draft; chrome?: { webview?: { postMessage: (data: unknown) => void; addEventListener: (name: string, listener: (event: MessageEvent) => void) => void } } } }

// 桌面宿主（WebView2 / WKWebView / WebKitGTK）注入的消息通道；浏览器预览中不存在。
const native = window.chrome?.webview;
export const isDesktop = !!native;
export const isMac = window.__workbenchPlatform === 'macos';
export const isLinux = window.__workbenchPlatform === 'linux';

const listeners = new Set<(state: State) => void>();
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> | undefined }>();
const updateListeners = new Set<(update: unknown) => void>();
// 服务首次推送完整状态，之后只推送变化的顶层字段（patch）与被省略的字段（removed），在最近一份完整状态上合并。
// 宿主的状态连接可能早于页面建立，页面没收到完整推送时以 state.get 的结果为基础；在此之前的增量直接忽略。
let latest: State | null = null;
const publish = (state: State) => { latest = state; listeners.forEach(fn => fn(state)); };
native?.addEventListener('message', ({ data }) => {
  if (data.event === 'state') { publish(data.state); return; }
  if (data.event === 'patch') {
    if (!latest) return;
    const next = { ...latest, ...data.patch } as Record<string, unknown>;
    for (const key of data.removed ?? []) delete next[key];
    publish(next as unknown as State);
    return;
  }
  if (data.event === 'update') { updateListeners.forEach(fn => fn(data.update)); return; }
  const callback = pending.get(data.id);
  if (!callback) return;
  clearTimeout(callback.timer); pending.delete(data.id);
  if (data.error) callback.reject(parseCallError(data.error)); else callback.resolve(data.result);
});

export function subscribeDesktop(listener: (state: State) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

// 宿主推送的应用更新状态，结构见 features/update/app-update.ts。
export function subscribeDesktopUpdate(listener: (update: unknown) => void) { updateListeners.add(listener); return () => { updateListeners.delete(listener); }; }

// 数据目录迁移在同一次调用里等待用户选择目录并同步复制全部数据，几 GB 模型远超 120 秒；
// 超时会先报未知错误而后台仍在复制，结束后又提示重启，因此只由宿主侧限时。
// 导出音频与文本要等用户在保存框里选好位置，停留多久都不算超时；长歌转码由本地服务限时。
const longCalls = new Set(['model.import', 'storage.directory', 'audio.export', 'output.export', 'text.export', 'export.encode', 'adapter.import']);

export function desktopCall<T>(method: string, data: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = longCalls.has(method) ? undefined : setTimeout(() => {
      pending.delete(id); reportDesktop('timeout', method, 'no reply within 120s');
      reject(new CallError('@yovoice.error.unknown', { detail: 'desktop timeout' }));
    }, 120000);
    pending.set(id, { resolve: value => { if (method === 'state.get' && !latest) latest = (value as { state?: State }).state ?? null; resolve(value as T); }, reject, timer }); native!.postMessage({ id, method, data });
  });
}

// 界面侧异常写入服务日志；只上报不等回复，上报失败也不影响界面。
export function reportDesktop(event: string, method: string, detail: string) {
  try { native?.postMessage({ id: crypto.randomUUID(), method: 'diag.client', data: { event, method, detail: detail.slice(0, 2000) } }); } catch { /* 宿主不可用时放弃上报。 */ }
}

export function desktopMediaUrl(kind: 'voices' | 'outputs', file: string): string {
  const base = window.__workbenchMediaBase;
  return base ? `${base}${kind}/${encodeURIComponent(file)}` : `https://${kind}.workbench.local/${encodeURIComponent(file)}`;
}
