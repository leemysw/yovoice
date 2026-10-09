import { test, expect } from '@playwright/test';
import { createDraft, emptyState } from '../src/shared/workbench';

// 原生宿主以纯文本报告失败原因（如文件不存在），提示需保留该原因，而不只显示通用错误。
test('宿主报告的失败原因显示在全局提示与对话框中', async ({ page }) => {
  const state = emptyState();
  state.drafts.push({ ...createDraft(), title: '待删除作品' });
  state.voices = [{ id: 'voice', name: '测试音色', fileName: 'voice.wav', duration: 3 }];
  await page.addInitScript(state => {
    let receive: (event: { data: unknown }) => void;
    Object.assign(window, {
      chrome: { webview: {
        addEventListener: (_name: string, listener: typeof receive) => { receive = listener; },
        postMessage: (message: { id: string; method: string }) => queueMicrotask(() => {
          if (message.method === 'media.reveal') receive({ data: { id: message.id, error: '音频文件不存在。' } });
          else if (message.method === 'draft.delete') receive({ data: { id: message.id, error: '作品文件被占用。' } });
          else receive({ data: { id: message.id, result: message.method === 'state.get' ? { state, catalog: [], desktop: true } : true } });
        }),
      } },
    });
  }, state);
  await page.goto('/');

  await page.getByTestId('nav-characters').click();
  await page.getByRole('tab', { name: '参考音频', exact: true }).click();
  await page.getByRole('button', { name: '打开位置测试音色', exact: true }).click();
  const notice = page.locator('.notice');
  await expect(notice).toHaveText('出了点问题，请重试。 (音频文件不存在。)');
  await page.getByRole('button', { name: '关闭提示' }).click();

  await page.getByTestId('nav-text').click();
  await page.locator('.project-library-row').filter({ hasText: '待删除作品' }).getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '删除作品', exact: true }).click();
  // 删除对话框只显示原因本身。
  await expect(dialog.getByRole('alert')).toHaveText('作品文件被占用。');
});
