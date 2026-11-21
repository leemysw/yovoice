import { test, expect } from '@playwright/test';

test.use({ reducedMotion: 'no-preference' });

test('快速切换页面时被跳过的视图过渡不会报错', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');

  const transcribe = page.getByTestId('nav-transcribe');
  await expect(transcribe).toBeVisible();
  // 同一帧内切换，确保前一次过渡还没就绪就被替换。
  await page.evaluate(() => {
    for (const id of ['nav-settings', 'nav-story', 'nav-transcribe']) {
      document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click();
    }
  });

  await expect(transcribe).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('html')).not.toHaveAttribute('data-transition');
  expect(errors).toEqual([]);
});

test('视图过渡的更新回调失败时会报告错误并清理状态', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');

  await page.evaluate(async () => {
    const modulePath = '/src/shared/lib/view-transition.ts';
    const { withViewTransition } = await import(/* @vite-ignore */ modulePath);
    withViewTransition(() => { throw new Error('View transition update failed'); }, 'page');
  });

  await expect(page.locator('html')).not.toHaveAttribute('data-transition');
  await expect.poll(() => errors).toEqual(['View transition update failed']);
});
