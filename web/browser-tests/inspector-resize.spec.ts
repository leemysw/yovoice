import { test, expect } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';

// 右侧检查器可拖动左边缘调宽，宽度刷新后保留；选项文字被截断时悬停显示完整文字。
test('检查器可拖动调整宽度，截断的选项悬停显示完整文字', async ({ page }) => {
  const state = emptyState();
  state.preferences.uiLocale = 'fr';
  state.preferences.introSeen = true;
  state.preferences.tourSeen = true;
  await seedState(page, state);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const inspector = page.locator('.inspector');
  await expect(inspector).toBeVisible();
  const before = (await inspector.boundingBox())!.width;

  // 默认宽度下法语的参考演绎标签放不下，悬停时挂上完整文字。
  const option = page.getByRole('radio', { name: 'Interprétation de référence' });
  await option.hover();
  await expect(option).toHaveAttribute('title', 'Interprétation de référence');

  const handle = page.getByRole('separator', { name: 'Redimensionner le panneau latéral' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBeGreaterThan(before + 100);
  const widened = (await inspector.boundingBox())!.width;

  await page.reload();
  await expect.poll(async () => Math.round((await inspector.boundingBox())!.width)).toBe(Math.round(widened));
});
