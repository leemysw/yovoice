import { test, expect, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';

const engine = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).preferences.engine ?? null);

// 引擎运行参数在设置 › 推理引擎里，对所有模型生效；会话参数默认收起，只列出当前引擎支持的项。
test('推理引擎运行参数保存在偏好里，会话参数按模型列出并可恢复默认', async ({ page }) => {
  const state = emptyState();
  Object.assign(state, { runtimePath: 'runtime', runtimeBackend: 'cpu', runtimeVersion: '1.0.0' });
  state.runtimeSessionOptions = { index_tts2: ['index_tts2.mem_saver', 'index_tts2.weight_type'] };
  // 旧引擎留下、当前引擎不支持的参数要提示并可清除。
  state.preferences.engine = { session: { 'index_tts2.speaker_cache_slots': 0 } };
  await seedState(page, state);
  await page.goto('/');
  // 检查器里不再有引擎参数。
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.getByText('运行参数')).toHaveCount(0);
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: '推理引擎' }).click();
  await expect(page.getByRole('heading', { name: '运行参数' })).toBeVisible();

  await expect(page.getByText('当前推理引擎不支持参数 index_tts2.speaker_cache_slots', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '清除这些参数' }).click();
  await expect.poll(() => engine(page)).toEqual({ session: {} });

  const threads = page.getByRole('spinbutton', { name: '推理线程数（0 为自动）' });
  await threads.fill('6');
  await threads.press('Enter');
  await expect.poll(() => engine(page)).toMatchObject({ threads: 6 });

  const session = page.getByTestId('engine-session');
  await session.locator('summary').click();
  // 只列出当前引擎支持的键，标签去掉模型族前缀。
  await expect(session.getByRole('switch', { name: 'mem_saver' })).toBeVisible();
  await expect(session.getByText('emotion_text_max_tokens')).toHaveCount(0);
  await session.getByRole('switch', { name: 'mem_saver' }).click();
  await expect.poll(() => engine(page)).toMatchObject({ threads: 6, session: { 'index_tts2.mem_saver': true } });

  await page.getByRole('button', { name: '恢复引擎默认' }).click();
  await expect.poll(() => engine(page)).toBeNull();
});
