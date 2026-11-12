import { useEffect, useState } from 'react';
import { call, isDesktop } from './client';

export interface EngineStatus {
  phase: 'stopped' | 'starting' | 'ready' | 'unloaded' | 'unloading' | 'unknown';
  modelId?: string;
  modelName?: string;
  idleUnloadSeconds: number;
}

// 串行查询，推理中更频繁；离开页面后不再排新请求。内核的元数据查询不会重置空闲卸载计时。
export function useEngineStatus(generating = false) {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  useEffect(() => {
    if (!isDesktop) return;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const next = await call<EngineStatus>('runtime.status');
        if (!closed) setStatus(next);
      } catch {
        if (!closed) setStatus({ phase: 'unknown', idleUnloadSeconds: 300 });
      } finally {
        if (!closed) timer = setTimeout(poll, generating ? 1000 : 5000);
      }
    }
    void poll();
    return () => { closed = true; clearTimeout(timer); };
  }, [generating]);
  return status;
}
