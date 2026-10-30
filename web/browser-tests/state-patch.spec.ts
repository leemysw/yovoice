import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// 桌面端状态推送：首次全量，之后只推送变化的字段（patch）与被省略的字段（removed），界面在最近的完整状态上合并。
const catalog = JSON.parse(readFileSync(new URL('../../internal/catalog/catalog.json', import.meta.url), 'utf8')).models;

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
