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
// 推送兜底：开始生成后服务会立即推送进度，5 秒内一条推送都没收到，说明宿主的状态推送断了（Windows 上出现过生成完成界面不动）。
// 此时记入服务日志，并改为每 3 秒拉取一次完整状态，收到推送后停止拉取。
const watchedCalls = new Set(['generation.start', 'generation.cue']);
let lastEvent = 0;
let polling: ReturnType<typeof setInterval> | undefined;
function streamAlive() {
  lastEvent = Date.now();
  if (!polling) return;
  clearInterval(polling); polling = undefined;
  reportDesktop('state_stream_resumed', '', '');
}
function watchStream(method: string, since: number) {
  setTimeout(() => {
    if (lastEvent >= since || polling) return;
    reportDesktop('state_stream_silent', method, 'no state event within 5s, polling state.get');
    polling = setInterval(() => { void desktopCall<{ state: State }>('state.get', {}).then(result => { if (polling) publish(result.state); }).catch(() => undefined); }, 3000);
  }, Math.max(0, since + 5000 - Date.now()));
}
native?.addEventListener('message', ({ data }) => {
  if (data.event === 'state') { streamAlive(); publish(data.state); return; }
  if (data.event === 'patch') {
    streamAlive();
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
// 导出音频与文本要等用户在保存框里选好位置，停留多久都不算超时。
const longCalls = new Set(['storage.directory', 'audio.export', 'output.export', 'text.export']);

export function desktopCall<T>(method: string, data: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = longCalls.has(method) ? undefined : setTimeout(() => {
      pending.delete(id); reportDesktop('timeout', method, 'no reply within 120s');
      reject(new CallError('@yovoice.error.unknown', { detail: 'desktop timeout' }));
    }, 120000);
    // 进度推送可能早于调用回复到达，计时从发出请求算起；调用失败时没有推送，不计。
    const sent = Date.now();
    pending.set(id, { resolve: value => { if (method === 'state.get' && !latest) latest = (value as { state?: State }).state ?? null; if (watchedCalls.has(method)) watchStream(method, sent); resolve(value as T); }, reject, timer }); native!.postMessage({ id, method, data });
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
