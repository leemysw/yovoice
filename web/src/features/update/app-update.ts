import { useSyncExternalStore } from 'react';
import { call, isDesktop } from '../../shared/lib/client';
import { subscribeDesktopUpdate } from '../../shared/lib/bridge';

// 桌面宿主的应用更新状态，与 Windows UpdateSnapshot、macOS UpdateSnapshot 字段一致。
// disabled：开发构建或冒烟测试，不检查更新；latest：已是最新；installing：正在保存并重启。
export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'downloading' | 'verifying' | 'ready' | 'latest' | 'failed' | 'installing';
export interface AppUpdate {
  current: string; status: UpdateStatus; version: string | null; notes: string | null; publishedAt: string | null;
  received: number; total: number; error: string | null; checkedAt: string | null; updatedFrom: string | null;
}

declare global { interface Window { __workbenchPreviewUpdate?: (update: AppUpdate | null) => void; __workbenchUpdateCalls?: string[] } }

export const projectUrl = 'https://github.com/leemysw/yovoice';
export const releasesUrl = `${projectUrl}/releases`;
export const releaseUrl = (version: string | null) => version ? `${releasesUrl}/tag/v${version}` : `${releasesUrl}/latest`;
// 新版本已发现但尚未安装的阶段：侧栏与设置导航据此提示。
export const updatePending = (update: AppUpdate | null) => !!update && ['downloading', 'verifying', 'ready', 'installing'].includes(update.status);

let snapshot: AppUpdate | null = null;
let started = false;
const listeners = new Set<() => void>();
const publish = (next: unknown) => {
  snapshot = next && typeof next === 'object' && 'status' in next ? next as AppUpdate : null;
  listeners.forEach(fn => fn());
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    if (isDesktop) {
      subscribeDesktopUpdate(publish);
      // 旧版宿主没有更新接口时保持隐藏。
      void call('app.update.get').then(publish).catch(() => undefined);
    } else {
      // 浏览器预览没有更新器；浏览器测试通过该入口注入宿主状态。
      window.__workbenchPreviewUpdate = publish;
    }
  }
  return () => { listeners.delete(listener); };
}

export function useAppUpdate() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

function updateCall(method: string) {
  if (isDesktop) return call(method);
  (window.__workbenchUpdateCalls ??= []).push(method);
  return Promise.resolve(true);
}
export const checkForUpdate = () => updateCall('app.update.check');
export const installUpdate = () => updateCall('app.update.install');
// 宿主菜单与界面入口都通过同一事件打开更新详情。
export const showUpdateDialog = () => window.dispatchEvent(new Event('workbench-show-update'));

export const updatePercent = (update: AppUpdate) => update.total > 0 ? Math.min(100, Math.floor(update.received / update.total * 100)) : null;
