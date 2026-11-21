import { saveAsCharacter } from './project-actions';
import { emptyState } from '../src/shared/workbench';
import { test, expect } from '@playwright/test';

test('连续输入新作品正文不会中断或丢字', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  await page.getByRole('menuitem', { name: '语音生成', exact: true }).click();
  const script = page.getByRole('textbox', { name: '正文', exact: true });
  await expect(script).toHaveValue('');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const text = 'Hello from the Windows desktop end-to-end test. This draft should survive navigation and restart.';
  // 在同一次任务里逐字提交原生编辑事件，模拟密集输入时保存状态的更新来不及处理。
  await script.evaluate((editor, value) => {
    editor.focus();
    for (const character of value) document.execCommand('insertText', false, character);
  }, text);
  expect(errors).toEqual([]);
  await expect(script).toHaveValue(text);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(script).toHaveValue(text);
});

// 删除正在编辑的作品后，离开编辑页的补存与自动保存都不能把它写回来。
test('删除当前作品后不会被自动保存恢复', async ({ page }) => {
  const state = emptyState();
  state.drafts = Array.from({ length: 3 }, (_, index) => ({ ...state.drafts[0], id: index.toString(16).padStart(32, '0'), title: `作品 ${index + 1}` }));
  await page.addInitScript(state => { if (!localStorage.getItem('voice-workbench-v1')) localStorage.setItem('voice-workbench-v1', JSON.stringify(state)); }, state);
  await page.goto('/');
  const recent = page.locator('.recent-projects');
  await recent.getByRole('button', { name: '作品 3', exact: true }).click();
  await page.getByLabel('正文', { exact: true }).fill('刚刚修改的内容');
  // 删除按钮悬停在这一行上才可点；编辑后作品会排到最前，鼠标不一定还在这一行，先悬停作品名再点。
  await recent.getByRole('button', { name: '作品 3', exact: true }).hover();
  await recent.getByRole('button', { name: '删除作品：作品 3', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除作品', exact: true }).click();
  await expect(recent.getByRole('button', { name: '作品 3', exact: true })).toHaveCount(0);
  await recent.getByRole('button', { name: '作品 1', exact: true }).click();
  await expect(page.getByLabel('作品名称')).toHaveValue('作品 1');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(recent.getByRole('button', { name: '作品 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '作品 3', exact: true })).toHaveCount(0);
});

// 窄屏时右侧面板自动收起：顶栏开关展开面板、再次点击收回，正文始终可以回到。
test('窄屏时顶栏开关展开和收回右侧面板', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 800 });
  await page.goto('/');
  const text = page.getByLabel('正文', { exact: true });
  await expect(text).toBeVisible();
  const toggle = page.locator('.browser-titlebar').getByRole('button', { name: /右侧面板/ });
  await toggle.click();
  await expect(page.locator('.inspector')).toBeVisible();
  await toggle.click();
  await expect(text).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

// 宽屏时开关收起和恢复检查器；离开工作区后标题栏事件不会跳回作品。
test('宽屏顶栏切换右侧面板，列表页忽略面板开关', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/');
  const inspector = page.locator('.inspector');
  await expect(inspector).toBeVisible();
  await page.getByRole('button', { name: '收起右侧面板' }).click();
  await expect(inspector).toBeHidden();
  await page.getByRole('button', { name: '展开右侧面板' }).click();
  await expect(inspector).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('workbench-toggle-inspector')));
  await expect(inspector).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('workbench-toggle-inspector')));
  await expect(inspector).toBeVisible();
  // 先打开过角色编辑器，其隐藏的创作区不能干扰开关（曾取到宽度为 0 的元素而无反应）。
  await saveAsCharacter(page);
  await expect(page.getByTestId('character-editor')).toBeVisible();
  await page.getByTestId('nav-text').click();
  await expect(page.getByTestId('character-editor')).toBeHidden();
  await page.getByRole('button', { name: '收起右侧面板' }).click();
  await expect(page.locator('.inspector:visible')).toHaveCount(0);
  await page.getByTestId('nav-story').click();
  await expect(page.getByRole('button', { name: /右侧面板/ })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('workbench-toggle-inspector')));
  await expect(page.getByTestId('nav-story')).toHaveAttribute('aria-current', 'page');
});

// 语音生成没有作品列表：从其他分类回到语音生成时直接继续最近的语音作品。
test('语音生成直接进入最近的语音作品', async ({ page }) => {
  const state = emptyState();
  const base = state.drafts[0];
  state.drafts = [
    { ...base, id: '1'.repeat(32), title: '较早的台词', updatedAt: '2026-01-01T00:00:00Z' },
    { ...base, id: '2'.repeat(32), title: '最近的台词', updatedAt: '2026-02-01T00:00:00Z' },
    { ...base, id: '3'.repeat(32), title: '雨夜故事', kind: 'story', subtitles: { speakers: [], cues: [] }, updatedAt: '2026-03-01T00:00:00Z' },
  ];
  await page.addInitScript(state => { if (!localStorage.getItem('voice-workbench-v1')) localStorage.setItem('voice-workbench-v1', JSON.stringify(state)); }, state);
  await page.goto('/');
  await page.getByTestId('nav-story').click();
  await page.locator('.project-library-row').filter({ hasText: '雨夜故事' }).getByRole('button', { name: '雨夜故事', exact: true }).click();
  await page.getByTestId('nav-text').click();
  await expect(page.getByLabel('作品名称')).toHaveValue('最近的台词');
  await expect(page.locator('.project-library-row:visible')).toHaveCount(0);
  await expect(page.getByTestId('nav-text')).toHaveAttribute('aria-current', 'page');
});
