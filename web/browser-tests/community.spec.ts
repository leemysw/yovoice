import { test, expect } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';
import { createMusicDraft } from '../src/features/music/music-draft';

test('分享歌曲到社区：先登录，填写后上传，设置里能看到并删除', async ({ page }, testInfo) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'e'.repeat(32), title: '夜航', text: 'Mandarin, folk, mandarin, dreamy bamboo flute countermelody over soft rain' };
  const state = emptyState();
  state.drafts = [draft];
  state.history = [{ id: 'song', title: draft.title, fileName: 'song.wav', createdAt: '2026-09-15T12:00:00Z', duration: 4, settings: draft }];
  // 登录会打开浏览器确认页，测试里不真的打开。
  await page.addInitScript(() => { window.open = () => null; });
  await page.goto('/');
  await seedState(page, state); await page.reload();

  await page.locator('.player .transport').getByRole('button', { name: '音频操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '分享到社区' }).click();
  const dialog = page.getByRole('dialog', { name: '分享到社区' });
  // 未登录时只有登录入口；开始后显示要核对的确认码，确认后进入表单。
  await dialog.getByRole('button', { name: '登录' }).click();
  await expect(dialog.getByText(/确认码 ABCD-EFGH/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('login.png') });
  await expect(dialog.getByRole('textbox', { name: '标题' })).toHaveValue('夜航');

  // 没同意条款不能分享；默认许可是非商用。
  const submit = dialog.getByRole('button', { name: '分享', exact: true });
  await expect(submit).toBeDisabled();
  await expect(dialog.getByRole('combobox', { name: '使用许可' })).toContainText('仅限非商用');
  // 标签默认带上生成时的短风格标签，重复和太长的不带；用户可以改。
  const tags = dialog.getByRole('textbox', { name: '标签' });
  await expect(tags).toHaveValue('Mandarin, folk');
  await tags.fill('民谣，夜晚');
  await dialog.getByRole('checkbox', { name: /同意社区条款/ }).check();
  await page.screenshot({ path: testInfo.outputPath('form.png') });
  await submit.click();
  await expect(dialog.getByRole('progressbar')).toBeVisible();
  await expect(dialog.getByText(/已提交审核/)).toBeVisible();
  await dialog.getByRole('button', { name: '关闭' }).last().click();
  await expect(dialog).toHaveCount(0);

  // 设置里列出刚分享的作品和审核状态，可以删除，也可以退出登录。
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: '社区' }).click();
  const row = page.locator('.settings-row', { hasText: '夜航' });
  await expect(row).toContainText('待审核');
  await page.screenshot({ path: testInfo.outputPath('settings.png') });
  await row.getByRole('button', { name: '删除' }).click();
  await page.getByRole('dialog', { name: '从社区删除' }).getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.settings-row', { hasText: '还没有分享过作品' })).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  // 退出后回到空态：一张空唱片、一句说明和登录入口。
  await expect(page.getByRole('heading', { name: '把你的歌放上社区的唱片架' })).toBeVisible();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('empty.png') });
});
