import { test, expect, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).preferences.theme ?? 'system');
const root = (page: Page) => page.locator('html');
// 卡片里的勾选框是隐藏的，像用户一样点卡片。
const pick = (page: Page, name: string) => page.getByTestId('theme-options').getByText(name, { exact: true }).click();

test('设置里切换主题立即生效、保存到偏好，刷新后保持；跟随系统时按系统深浅选纸白或夜墨', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await seedState(page, emptyState());
  await page.goto('/');
  // 默认跟随系统，浅色系统下是纸白。
  await expect(root(page)).toHaveAttribute('data-astryx-theme', 'yovoice-paper');
  await page.getByTestId('nav-settings').click();
  const options = page.getByTestId('theme-options');
  await expect(options.getByRole('checkbox', { name: '跟随系统' })).toBeChecked();
  await expect(options.getByRole('checkbox')).toHaveCount(7);

  await pick(page, '夜墨');
  await expect(root(page)).toHaveAttribute('data-astryx-theme', 'yovoice-ink');
  await expect(root(page)).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => saved(page)).toBe('ink');
  // 主按钮跟着主题的强调色走：夜墨下是浅底深字。
  const newProject = page.getByTestId('nav-new');
  await expect(newProject).toHaveCSS('background-color', 'rgb(237, 237, 239)');

  await pick(page, '青岸');
  await expect(root(page)).toHaveAttribute('data-astryx-theme', 'yovoice-lagoon');
  await expect(root(page)).toHaveAttribute('data-theme', 'light');
  await expect(newProject).toHaveCSS('background-color', 'rgb(11, 122, 128)');
  await expect.poll(() => saved(page)).toBe('lagoon');

  await page.reload();
  await expect(root(page)).toHaveAttribute('data-astryx-theme', 'yovoice-lagoon');

  // 回到跟随系统：偏好里不再记录主题，系统换成深色时改用夜墨。
  await page.getByTestId('nav-settings').click();
  await pick(page, '跟随系统');
  await expect.poll(() => saved(page)).toBe('system');
  await expect(root(page)).toHaveAttribute('data-astryx-theme', 'yovoice-paper');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root(page)).toHaveAttribute('data-astryx-theme', 'yovoice-ink');
});
