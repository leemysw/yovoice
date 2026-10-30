import { test, expect, type Page } from '@playwright/test';
import type { AppUpdate } from '../src/features/update/app-update';
import { releaseNotes } from '../src/features/update/release-notes';

const notes = '## [0.3.0] - 2026-10-20\n\n### English\n\n- Faster `score` rendering.\n- Fix exit saving.\n\n### 简体中文\n\n- 编曲渲染更快，支持 `score` 命令。\n- 修复退出保存。\n';
const base: AppUpdate = { current: '0.2.0', status: 'idle', version: null, notes: null, publishedAt: null, received: 0, total: 0, error: null, checkedAt: null, updatedFrom: null };

// 浏览器预览没有原生更新器，用预留入口模拟宿主推送的状态。
async function push(page: Page, update: Partial<AppUpdate>) {
  await page.waitForFunction(() => typeof window.__workbenchPreviewUpdate === 'function');
  await page.evaluate(next => window.__workbenchPreviewUpdate!(next), { ...base, ...update });
}

test('发布说明按界面语言取对应一节，缺失时退回另一种语言', () => {
  expect(releaseNotes(notes, 'zh-CN')).toEqual([{ kind: 'item', text: '编曲渲染更快，支持 `score` 命令。' }, { kind: 'item', text: '修复退出保存。' }]);
  expect(releaseNotes(notes, 'en').map(block => block.text)).toEqual(['Faster `score` rendering.', 'Fix exit saving.']);
  expect(releaseNotes('### English\n- Only English', 'zh-CN')).toEqual([{ kind: 'item', text: 'Only English' }]);
  expect(releaseNotes('Plain body\n- item', 'en')).toEqual([{ kind: 'text', text: 'Plain body' }, { kind: 'item', text: 'item' }]);
});

test('应用更新：发现新版本提示下载进度，就绪后查看更新内容并重启更新', async ({ page }) => {
  await page.goto('/');
  // 没有更新状态时不显示任何更新入口。
  await expect(page.getByTestId('sidebar-update')).toHaveCount(0);

  await push(page, { status: 'downloading', version: '0.3.0', notes, publishedAt: '2026-10-20T08:00:00Z', received: 21e6, total: 84e6 });
  const notice = page.getByTestId('update-notice');
  await expect(notice).toContainText('发现新版本 0.3.0，正在后台下载');
  const sidebar = page.getByTestId('sidebar-update');
  await expect(sidebar).toContainText('正在下载 0.3.0');
  await expect(sidebar.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');

  // 下载中打开详情：显示版本变化、进度和对应语言的更新内容。
  await notice.getByRole('button', { name: '查看更新内容' }).click();
  const dialog = page.getByTestId('update-dialog');
  await expect(dialog).toContainText('当前 0.2.0 → 新版本 0.3.0');
  await expect(dialog).toContainText('20.03 MB / 80.11 MB');
  await expect(dialog.getByTestId('release-notes').locator('li')).toHaveText(['编曲渲染更快，支持 score 命令。', '修复退出保存。']);
  await expect(dialog.getByRole('link', { name: '在 GitHub 查看' })).toHaveAttribute('href', 'https://github.com/leemysw/yovoice/releases/tag/v0.3.0');
  await page.getByRole('button', { name: '在后台继续' }).click();
  await expect(dialog).toHaveCount(0);

  // 下载完成：提示可重启，侧栏与设置页都提供重启入口。
  await push(page, { status: 'ready', version: '0.3.0', notes, received: 84e6, total: 84e6 });
  await expect(notice).toContainText('新版本 0.3.0 已准备好，重启即可更新');
  await expect(sidebar.getByRole('button', { name: '重启并更新' })).toBeVisible();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('update-status')).toHaveText('0.3.0 已准备好');
  await notice.getByRole('button', { name: '重启并更新' }).click();
  expect(await page.evaluate(() => window.__workbenchUpdateCalls)).toEqual(['app.update.install']);

  // 关闭提示后本次不再出现，侧栏入口保留。
  await notice.getByRole('button', { name: '关闭提示' }).click();
  await expect(notice).toHaveCount(0);
  await expect(sidebar).toBeVisible();
});

test('应用更新：设置页检查更新、失败重试与更新后的新功能提示', async ({ page }) => {
  await page.goto('/');
  await push(page, { status: 'latest', checkedAt: '2026-10-12T08:00:00Z' });
  await page.getByTestId('nav-settings').click();
  const status = page.getByTestId('update-status');
  await expect(status).toContainText('已是最新版本');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  expect(await page.evaluate(() => window.__workbenchUpdateCalls)).toEqual(['app.update.check']);

  await push(page, { status: 'failed', error: '无法连接更新服务，请检查网络或代理后重试。' });
  await expect(status).toHaveText('无法连接更新服务，请检查网络或代理后重试。');
  await page.evaluate(() => window.dispatchEvent(new Event('workbench-show-update')));
  const dialog = page.getByTestId('update-dialog');
  await expect(dialog.getByRole('alert')).toHaveText('无法连接更新服务，请检查网络或代理后重试。');
  await page.getByRole('button', { name: '重试' }).click();
  expect(await page.evaluate(() => window.__workbenchUpdateCalls)).toEqual(['app.update.check', 'app.update.check']);
  await page.getByRole('button', { name: '关闭', exact: true }).first().click();

  // 刚完成更新：提示已更新，并可查看本版本更新内容。
  await push(page, { current: '0.3.0', status: 'latest', version: '0.3.0', notes, updatedFrom: '0.2.0' });
  const notice = page.getByTestId('update-notice');
  await expect(notice).toContainText('已更新到 0.3.0');
  await notice.getByRole('button', { name: '查看更新内容' }).click();
  await expect(dialog).toContainText('本版本更新内容');
  await expect(dialog.getByTestId('release-notes').locator('li')).toHaveCount(2);
});
