import { test, expect } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';

test('新建五种作品、取消导入、卡片菜单与重命名独立保存', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('nav-new').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('menuitem')).toHaveCount(7);
  await page.screenshot({ path: testInfo.outputPath('new-project-menu.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByTestId('nav-new')).toBeFocused();
  await page.getByTestId('nav-new').press('Enter');
  await page.getByRole('menuitem', { name: '故事配音', exact: true }).click();
  await page.getByLabel('作品名称').fill('雨夜故事');
  await page.getByRole('button', { name: '新增台词', exact: true }).click();
  await page.getByLabel('第 1 句台词').fill('第一句。第二句。');
  await page.getByLabel('第 1 句台词').evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(4, 4));
  await page.getByLabel('第 1 句台词').press('Enter');
  await expect(page.getByLabel('第 2 句台词')).toHaveValue('第二句。');
  await expect(page.getByLabel('第 2 句台词')).toBeFocused();
  await page.getByTestId('nav-story').click();
  const row = page.locator('.project-library-row').filter({ hasText: '雨夜故事' });
  await expect(row.getByRole('button', { name: '雨夜故事', exact: true })).toBeVisible();
  // 标题完整显示时悬浮不再重复同样的文字，只有被截断才给出完整标题。
  await row.getByRole('button', { name: '雨夜故事', exact: true }).hover();
  await expect(row.getByRole('button', { name: '雨夜故事', exact: true })).not.toHaveAttribute('title');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(row).not.toContainText('故事配音');
  await expect(row.locator('time')).toHaveAttribute('title', /创建于/);
  await row.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByRole('dialog').getByLabel('作品名称').fill('雨夜');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  const renamed = page.locator('.project-library-row').filter({ hasText: '雨夜' });
  await expect(page.getByRole('combobox', { name: '进行中' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('projects.png') });
  await renamed.getByRole('button', { name: '雨夜', exact: true }).click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入字幕', exact: true }).click();
  await (await choosing).setFiles([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts.length)).toBe(2);
  const importing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入字幕', exact: true }).click();
  await (await importing).setFiles({ name: '多人.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:02.000\n<v Alice>你好\n') });
  await expect(page.getByLabel('作品名称')).toHaveValue('多人');
  await expect(page.getByLabel('第 1 句台词')).toHaveValue('你好');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts.length)).toBe(3);
  await page.reload();
  await page.getByTestId('nav-story').click();
  await page.getByRole('button', { name: '雨夜', exact: true }).last().click();
  await expect(page.getByLabel('第 1 句台词')).toHaveValue('第一句。');
});

test('本机接口：开关、端口与令牌在设置 › 通用中管理', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  const status = page.getByTestId('local-api-status');
  await expect(status).toHaveText('未开启，不占用端口。');
  await page.getByRole('switch', { name: '启用本机接口' }).click();
  await expect(status).toHaveText('运行中：http://127.0.0.1:8080');
  await page.getByRole('textbox', { name: '端口' }).fill('80');
  await page.getByRole('textbox', { name: '端口' }).press('Enter');
  await expect(page.getByText('端口需在 1024–65535 之间。')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '端口' })).toHaveValue('8080');
  await page.getByRole('textbox', { name: '端口' }).fill('18080');
  await page.getByRole('textbox', { name: '端口' }).press('Enter');
  await expect(status).toHaveText('运行中：http://127.0.0.1:18080');
  await expect(page.getByText('curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:18080/v1/status')).toBeVisible();
  const token = page.getByLabel('访问令牌', { exact: true });
  const before = await token.inputValue();
  await page.getByRole('button', { name: '重置' }).click();
  await expect(token).not.toHaveValue(before);
  await page.getByTestId('local-api-status').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('local-api-settings.png'), animations: 'disabled' });
});

test('导入文件配音：文本、Markdown 与 GBK 编码进入语音作品，字幕进入故事作品', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('input[type=file][aria-label="导入文件配音"]');
  const editor = page.getByLabel('正文', { exact: true });
  await page.getByTestId('nav-new').click();
  await expect(page.getByRole('menuitem', { name: '导入文件配音' })).toBeVisible();
  await page.keyboard.press('Escape');
  await input.setInputFiles({ name: '开场白.txt', mimeType: 'text/plain', buffer: Buffer.from('第一段。\r\n\r\n\r\n第二段。  \r\n') });
  await expect(editor).toHaveValue('第一段。\n\n第二段。');
  await expect(page.getByLabel('作品名称')).toHaveValue('开场白');
  // Windows 记事本常见的 GBK 编码：“你好”。
  await input.setInputFiles({ name: '问候.txt', mimeType: 'text/plain', buffer: Buffer.from([0xc4, 0xe3, 0xba, 0xc3]) });
  await expect(editor).toHaveValue('你好');
  await input.setInputFiles({ name: '讲稿.md', mimeType: 'text/markdown', buffer: Buffer.from('# 标题\n\n- 第**一**点，见[文档](https://example.com)\n\n```js\ncode()\n```\n') });
  await expect(editor).toHaveValue('标题\n\n第一点，见文档');
  await input.setInputFiles({ name: '对白.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:00,000 --> 00:00:01,000\n你好\n\n2\n00:00:01,000 --> 00:00:02,000\n再见\n') });
  await expect(page.getByLabel('第 2 句台词', { exact: true })).toHaveValue('再见');
  await input.setInputFiles({ name: '空白.txt', mimeType: 'text/plain', buffer: Buffer.from('   \n') });
  await expect(page.getByText('文件里没有可朗读的文字。')).toBeVisible();
  await input.setInputFiles({ name: '超长.txt', mimeType: 'text/plain', buffer: Buffer.from('字'.repeat(12001)) });
  await expect(page.getByText('文本超过 12000 字，请拆分成几个文件后分别导入。')).toBeVisible();
});

test('存储设置：展示数据目录与占用明细，可更改位置与清理残留', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByRole('heading', { name: '存储' })).toBeVisible();
  await expect(page.getByText('数据存储目录')).toBeVisible();
  await expect(page.getByText(/占用：总计/)).toBeVisible();
  await expect(page.getByRole('button', { name: '更改位置' })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开文件夹' })).toBeVisible();
  await page.getByRole('button', { name: '清理残留' }).click();
  await expect(page.getByText('没有发现超过 24 小时的残留文件。')).toBeVisible();
  await page.getByRole('button', { name: '更改位置' }).click();
  await expect(page.getByText(/^数据已复制到新目录。请完全退出 yovoice 并重新打开应用生效/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('storage-settings.png'), animations: 'disabled' });
});

test('启动动画在脚本加载前显示，界面就绪后移除，不挡住操作', async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/main.tsx', async route => { await gate; await route.continue(); });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#splash .tile')).toBeVisible();
  release();
  await expect(page.locator('#splash')).toHaveCount(0);
  await page.getByTestId('nav-new').click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
});

test('首次启动显示开场画面，点「开始探索」进入主界面并记住，再次打开不再显示', async ({ page }) => {
  const state = emptyState();
  await seedState(page, { ...state, preferences: { ...state.preferences, introSeen: false } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const intro = page.getByRole('dialog', { name: 'yovoice' });
  await expect(intro.getByText('让文字发声，把灵感谱成歌')).toBeVisible();
  await expect(intro.getByText('故事配音')).toBeVisible();
  const start = intro.getByRole('button', { name: '开始探索' });
  await expect(start).toBeFocused();
  await start.press('Enter');
  await expect(intro).toHaveCount(0);
  await page.getByTestId('nav-new').click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('nav-new')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'yovoice' })).toHaveCount(0);
  // 设置里可以重新播放，看完不影响已记住的状态。
  await page.getByTestId('nav-settings').click();
  await page.getByRole('button', { name: '重新播放' }).click();
  await page.getByRole('dialog', { name: 'yovoice' }).getByRole('button', { name: '开始探索' }).click();
  await expect(page.getByRole('dialog', { name: 'yovoice' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('nav-new')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'yovoice' })).toHaveCount(0);
});

test('开场画面一出现就完全盖住主界面，不会先露出面板', async ({ page }) => {
  const state = emptyState();
  await seedState(page, { ...state, preferences: { ...state.preferences, introSeen: false } });
  await page.goto('/');
  await page.waitForSelector('.intro-screen', { state: 'attached' });
  // 挂载的同一帧里就必须不透明；若先从透明淡入，主界面会透出来。
  expect(await page.locator('.intro-screen').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
});

test('引擎设置：CUDA 可启用性能优先并保存，非 CUDA 隐藏', async ({ page }) => {
  const state = emptyState();
  await seedState(page, { ...state, preferences: { ...state.preferences, backend: 'cuda' } });
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: '推理引擎', exact: true }).click();
  const performanceFirst = page.locator('input[name="performanceFirst"]');
  await expect(performanceFirst).toBeVisible();
  await expect(performanceFirst).not.toBeChecked();
  await performanceFirst.click();
  await expect(performanceFirst).toBeChecked();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).preferences.performanceFirst)).toBe(true);
  await page.reload();
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: '推理引擎', exact: true }).click();
  await expect(performanceFirst).toBeChecked();
  await page.getByRole('combobox', { name: '计算设备', exact: true }).click();
  await page.getByRole('option', { name: 'CPU', exact: true }).click();
  await expect(performanceFirst).toHaveCount(0);
  await page.getByRole('combobox', { name: '计算设备', exact: true }).click();
  await page.getByRole('option', { name: /CUDA 13\.3/ }).click();
  await expect(performanceFirst).toBeVisible();
  await expect(performanceFirst).toBeChecked();
});
