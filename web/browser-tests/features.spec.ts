import { test, expect, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).preferences.hiddenFeatures ?? []);

test('设置里隐藏故事配音、音乐生成、语音转写和 Ocho 后入口消失，重新打开即恢复', async ({ page }) => {
  await seedState(page, emptyState());
  await page.goto('/');
  // 默认全部显示。
  for (const id of ['nav-story', 'nav-music', 'nav-transcribe', 'assistant-toggle']) await expect(page.getByTestId(id)).toBeVisible();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByRole('heading', { name: '功能显示' })).toBeVisible();
  for (const name of ['故事配音', '音乐生成', '语音转写', 'Ocho']) {
    await expect(page.getByRole('switch', { name })).toBeChecked();
    await page.getByRole('switch', { name }).click();
  }
  await expect.poll(() => saved(page)).toEqual(['story', 'music', 'transcribe', 'assistant']);
  for (const id of ['nav-story', 'nav-music', 'nav-transcribe', 'assistant-toggle']) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '音乐模型' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Ocho' })).toHaveCount(0);
  // Ocho 与音乐生成都关闭时，AI 服务一并隐藏。
  await expect(page.getByRole('tab', { name: 'AI 服务' })).toHaveCount(0);
  // 新建菜单只保留语音生成与导入。
  await page.getByTestId('nav-new').click();
  await expect(page.getByRole('menuitem', { name: '语音生成' })).toBeVisible();
  for (const name of ['故事配音', '音乐生成', '编曲生成']) await expect(page.getByRole('menuitem', { name })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // ⌘J 不再打开助手。
  await page.keyboard.press('ControlOrMeta+j');
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('nav-story')).toHaveCount(0);
  await page.getByTestId('nav-settings').click();
  await page.getByRole('switch', { name: '音乐生成' }).click();
  await expect(page.getByTestId('nav-music')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'AI 服务' })).toBeVisible();
  await expect.poll(() => saved(page)).toEqual(['story', 'transcribe', 'assistant']);
});

test('停在已隐藏功能的页面时回到语音生成', async ({ page }) => {
  const state = emptyState();
  state.preferences.hiddenFeatures = ['transcribe'];
  await seedState(page, state);
  await page.addInitScript(() => localStorage.setItem('yovoice-active-page', 'transcribe'));
  await page.goto('/');
  await expect(page.getByTestId('nav-transcribe')).toHaveCount(0);
  await expect(page.getByTestId('nav-text')).toHaveAttribute('aria-current', 'page');
});
