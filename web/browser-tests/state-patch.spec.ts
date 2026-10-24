import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// 桌面端状态推送：首次全量，之后只推送变化的字段（patch）与被省略的字段（removed），界面在最近的完整状态上合并。
const catalog = JSON.parse(readFileSync(new URL('../src/shared/lib/catalog.json', import.meta.url), 'utf8'));

test('增量推送合并进完整状态，宿主连接早于页面时以 state.get 为基础', async ({ page }) => {
  await page.goto('/');
  // 用预览的初始状态作为桌面服务返回的状态。
  await page.evaluate(async () => {
    const source = '/src/shared/workbench.ts';
    const workbench = await import(/* @vite-ignore */ source);
    const state = workbench.emptyState();
    state.drafts = [{ ...workbench.createDraft(false), id: 'a', title: '歌曲甲', kind: 'music', updatedAt: '2026-01-01T00:00:00Z' }];
    sessionStorage.setItem('desktop-state', JSON.stringify(state));
  });
  await page.addInitScript(catalog => {
    type Listener = (event: { data: unknown }) => void;
    const callbacks = new Set<Listener>();
    const state = JSON.parse(sessionStorage.getItem('desktop-state')!);
    const emit = (data: unknown) => callbacks.forEach(fn => fn({ data }));
    Object.assign(window, {
      __emit: emit, __state: state,
      chrome: { webview: { addEventListener: (_: string, fn: Listener) => callbacks.add(fn), postMessage: (message: { id: string; method: string }) => setTimeout(() => emit({ id: message.id, result: message.method === 'state.get' ? { state, catalog, engine: { version: '', minimum: '' }, desktop: true, assistant: { available: true } } : null })) } },
    });
  }, catalog);
  await page.goto('/');
  const panel = page.getByRole('navigation', { name: '主导航' });
  await expect(panel.getByRole('button', { name: '歌曲甲', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const { __emit: emit, __state: state } = window as unknown as { __emit: (data: unknown) => void; __state: { drafts: object[] } };
    emit({ event: 'patch', patch: { drafts: [...state.drafts, { ...state.drafts[0], id: 'b', title: '歌曲乙', updatedAt: '2026-01-02T00:00:00Z' }] }, removed: [] });
  });
  await expect(panel.getByRole('button', { name: '歌曲乙', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '歌曲甲', exact: true })).toBeVisible();
});

test('宿主状态推送中断：开始生成后收不到推送时记入日志并改为拉取状态，推送恢复后停止拉取', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const source = '/src/shared/workbench.ts';
    const workbench = await import(/* @vite-ignore */ source);
    const state = workbench.emptyState();
    state.drafts = [{ ...workbench.createDraft(false), id: 'a', title: '清晨旁白', kind: 'text', text: '早上好', updatedAt: '2026-01-01T00:00:00Z' }];
    sessionStorage.setItem('desktop-state', JSON.stringify(state));
  });
  await page.addInitScript(catalog => {
    type Listener = (event: { data: unknown }) => void;
    const callbacks = new Set<Listener>();
    const state = JSON.parse(sessionStorage.getItem('desktop-state')!);
    const calls: { method: string; data: unknown }[] = [];
    const emit = (data: unknown) => callbacks.forEach(fn => fn({ data }));
    // 宿主只回复调用、不转发状态推送：生成开始后服务端状态变了，界面只能靠拉取看到。
    const reply = (method: string) => {
      if (method === 'state.get') return { state: structuredClone(state), catalog, engine: { version: '', minimum: '' }, desktop: true, assistant: { available: true } };
      if (method === 'generation.start') state.activity = { projectId: 'a', kind: 'generate', code: '@yovoice.activity.generate', params: null, status: 'running', received: 0, total: 0, errorCode: null, errorParams: null, modelId: null, startedAt: new Date().toISOString() };
      return null;
    };
    Object.assign(window, {
      __emit: emit, __state: state, __calls: calls,
      chrome: { webview: { addEventListener: (_: string, fn: Listener) => callbacks.add(fn), postMessage: (message: { id: string; method: string; data: unknown }) => { calls.push({ method: message.method, data: message.data }); setTimeout(() => emit({ id: message.id, result: reply(message.method) })); } } },
    });
  }, catalog);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '生成语音', exact: true }).first()).toBeVisible();
  await page.evaluate(async () => {
    const source = '/src/shared/lib/client.ts';
    const client = await import(/* @vite-ignore */ source);
    await client.call('generation.start', {});
  });
  // 5 秒内没有推送：记入日志，并经拉取显示生成中。
  await expect(page.getByRole('button', { name: '取消生成' }).first()).toBeVisible({ timeout: 12000 });
  const reported = await page.evaluate(() => (window as unknown as { __calls: { method: string; data: { event?: string } }[] }).__calls.filter(c => c.method === 'diag.client').map(c => c.data.event));
  expect(reported).toContain('state_stream_silent');
  // 服务端完成：拉取到完成状态后按钮恢复。
  await page.evaluate(() => { const s = (window as unknown as { __state: { activity: { status: string; code: string } } }).__state; s.activity.status = 'completed'; s.activity.code = '@yovoice.activity.completed'; });
  await expect(page.getByRole('button', { name: '取消生成' })).toHaveCount(0, { timeout: 8000 });
  // 推送恢复后停止拉取。
  await page.evaluate(() => (window as unknown as { __emit: (data: unknown) => void }).__emit({ event: 'patch', patch: {}, removed: [] }));
  const count = () => page.evaluate(() => (window as unknown as { __calls: { method: string }[] }).__calls.filter(c => c.method === 'state.get').length);
  const before = await count();
  await page.waitForTimeout(4000);
  expect(await count()).toBe(before);
});
