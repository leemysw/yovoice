import { emptyState } from '../src/shared/workbench';
import { test, expect } from '@playwright/test';

test('代理地址失焦自动保存，开关与地址重载后保留', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  const address = page.getByRole('textbox', { name: '代理地址' });
  const save = page.getByRole('button', { name: '保存代理' });
  const enabled = page.getByRole('switch', { name: '启用代理' });
  await expect(enabled).not.toBeChecked();
  await expect(enabled).toBeDisabled();
  await expect(save).toHaveCount(0);
  await address.fill('  http://127.0.0.1:7890  ');
  await page.getByRole('heading', { name: '网络代理' }).click();
  await expect(address).toHaveValue('http://127.0.0.1:7890');
  await page.reload();
  await page.getByTestId('nav-settings').click();
  await expect(address).toHaveValue('http://127.0.0.1:7890');
  await expect(enabled).not.toBeChecked();
  await enabled.click();
  await expect(enabled).toBeChecked();
  await page.reload();
  await page.getByTestId('nav-settings').click();
  await expect(enabled).toBeChecked();
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await page.reload();
  await page.getByTestId('nav-settings').click();
  await expect(enabled).not.toBeChecked();
  await expect(address).toHaveValue('http://127.0.0.1:7890');
  await address.fill('http://127.0.0.1:7891');
  await enabled.click();
  await expect(enabled).toBeChecked();
  await page.getByTestId('nav-create').click();
  await page.getByTestId('nav-settings').click();
  await expect(address).toHaveValue('http://127.0.0.1:7891');
  await address.fill('');
  await page.getByRole('tab', { name: '模型', exact: true }).click();
  await page.getByRole('tab', { name: '常规', exact: true }).click();
  await expect(enabled).not.toBeChecked();
  await page.reload();
  await page.getByTestId('nav-settings').click();
  await expect(address).toHaveValue('');
});

test('四种表达方式、草稿持久化与模型协议', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByLabel('作品名称')).toHaveValue('清晨旁白');
  await page.getByRole('radio', { name: '跟随音色', exact: true }).click();
  await expect(page.getByText('沿用参考音色中的自然表达。')).toBeVisible();
  await page.getByRole('radio', { name: '参考演绎', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加演绎参考' })).toBeVisible();
  await page.getByRole('radio', { name: '情绪调节', exact: true }).click();
  await expect(page.getByRole('group', { name: '情绪预设', exact: true }).getByRole('button')).toHaveCount(3);
  const more = page.getByRole('button', { name: '更多情绪', exact: true });
  const tuning = page.getByRole('button', { name: '微调情绪', exact: true });
  await more.hover();
  await expect(more).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(more).toHaveCSS('background-image', 'none');
  const moreBox = await more.boundingBox();
  const tuningBox = await tuning.boundingBox();
  expect(moreBox!.x).toBe(tuningBox!.x);
  expect(moreBox!.height).toBe(tuningBox!.height);
  expect((await more.locator('svg').boundingBox())!.x).toBe((await tuning.locator('svg').boundingBox())!.x);
  await page.getByRole('button', { name: '更多情绪', exact: true }).click();
  await page.getByText('微调情绪', { exact: true }).click();
  await expect(page.getByRole('slider', { name: '高兴', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '惊喜', exact: true }).click();
  await expect(page.getByRole('button', { name: '惊喜', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('slider', { name: '高兴', exact: true })).toHaveAttribute('aria-valuenow', '0.4');
  await page.getByRole('slider', { name: '高兴', exact: true }).press('ArrowRight');
  await expect(page.getByRole('button', { name: '惊喜', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '悲伤', exact: true }).click();
  await expect(page.getByRole('slider', { name: '悲伤', exact: true })).toHaveAttribute('aria-valuenow', '0.5');
  await page.getByRole('button', { name: '收起情绪', exact: true }).click();
  await expect(page.getByRole('button', { name: '悲伤', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '更多情绪', exact: true }).click();
  await expect(page.getByRole('button', { name: '悲伤', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByRole('slider', { name: '惊讶', exact: true })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('radio', { name: '文字指导', exact: true }).click();
  await page.getByLabel('作品名称').fill('测试旁白');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByLabel('作品名称')).toHaveValue('测试旁白');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '模型', exact: true }).click();
  await expect(page.getByRole('button', { name: '下载模型', exact: true })).toHaveCount(21);
  await page.getByRole('button', { name: 'IndexTTS 协议' }).click();
  await expect(page.getByRole('heading', { name: '模型使用协议' })).toBeVisible();
  await page.getByRole('button', { name: '关闭协议' }).click();
  expect(errors).toEqual([]);
});

test('真实 WAV 导入、播放、裁剪和空状态', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  const wav = Buffer.alloc(44 + 16000 * 2 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 32000; i++) wav.writeInt16LE(Math.round(Math.sin(i * 440 * Math.PI * 2 / 16000) * 8000), 44 + i * 2);
  await page.locator('input[type=file]').setInputFiles({ name: '测试音色.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.getByRole('button', { name: '测试音色', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '试听当前音色' }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const progress = page.getByRole('slider', { name: '播放进度' });
  await expect(progress).toBeVisible();
  const lane = page.locator('.timeline-lane');
  const originalWidth = await page.locator('.waveform').evaluate(el => el.getBoundingClientRect().width);
  await page.getByRole('button', { name: '放大音轨', exact: true }).click();
  await expect(page.getByRole('button', { name: '适应完整音轨' })).toHaveText('200%');
  expect(await page.locator('.waveform').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(originalWidth * 1.9);
  await lane.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect(await lane.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await progress.fill('1.5');
  await expect.poll(() => page.locator('footer audio').evaluate((el: HTMLAudioElement) => el.currentTime)).toBeCloseTo(1.5, 1);
  await page.getByRole('button', { name: '适应完整音轨' }).click();
  await expect(page.getByRole('button', { name: '缩小音轨' })).toBeDisabled();
  expect(await lane.evaluate(el => el.scrollLeft)).toBe(0);
  await progress.fill('1');
  await expect.poll(() => page.locator('footer audio').evaluate((el: HTMLAudioElement) => el.currentTime)).toBeCloseTo(1, 1);
  await page.getByRole('button', { name: '回到开头' }).click();
  await expect(progress).toHaveValue('0');
  await page.getByRole('button', { name: '静音', exact: true }).click();
  await expect.poll(() => page.locator('footer audio').evaluate((el: HTMLAudioElement) => el.volume)).toBe(0);
  await page.getByRole('button', { name: '取消静音' }).click();
  await page.getByRole('button', { name: '测试音色', exact: true }).click();
  await page.getByRole('button', { name: '试听测试音色', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('.library-preview')).toBeVisible();
  await page.getByRole('button', { name: '裁剪', exact: true }).click();
  await page.getByRole('button', { name: '另存为新音色' }).click();
  await expect(page.getByRole('button', { name: '测试音色 · 裁剪', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '声音库', exact: true }).click();
  await expect(page.locator('footer.player')).toHaveCount(0);
  await page.getByRole('button', { name: '添加声音', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: '添加声音' })).toBeVisible();
  await expect(page.getByRole('dialog').locator('.voice-list')).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles({ name: '新增音色.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '新增音色', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '创作', exact: true }).click();
  await expect(page.getByRole('button', { name: '测试音色 · 裁剪', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '声音库', exact: true }).click();

  await page.getByRole('button', { name: '试听测试音色', exact: true }).click();
  const preview = page.locator('.library-preview audio');
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > 0)).toBeTruthy();
  const controls = page.locator('.library-preview');
  await expect(preview).not.toHaveAttribute('controls');
  await controls.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => audio.paused)).toBeTruthy();
  await controls.getByRole('slider', { name: '播放进度' }).fill('1');
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeCloseTo(1, 1);
  await controls.getByRole('button', { name: '静音', exact: true }).click();
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => audio.volume)).toBe(0);
  await controls.getByRole('button', { name: '取消静音' }).click();
  const play = controls.getByRole('button', { name: '播放', exact: true });
  await play.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(play).toBeFocused();
  await expect(play).toHaveCSS('outline-width', '1px');
  await play.press('Enter');
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => audio.paused)).toBeFalsy();
  await page.getByRole('button', { name: '收起试听测试音色', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: '试听测试音色', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '模型', exact: true }).click();
  await expect(page.locator('audio')).toHaveCount(0);
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  await expect(page.locator('footer.player')).toHaveCount(0);
  await page.getByRole('button', { name: '创作', exact: true }).click();
  await expect(page.locator('footer.player')).toBeVisible();
  await expect.poll(() => page.locator('footer audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBeTruthy();
});

test('窄屏切换声音设置后可以返回正文', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: '声音设置', exact: true }).click();
  await expect(page.getByRole('radio', { name: '文字指导', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回正文' }).click();
  await expect(page.getByLabel('正文', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('单选与设置标签支持方向键，弹窗错误就地显示', async ({ page }) => {
  await page.goto('/');
  const natural = page.getByRole('radio', { name: '跟随音色', exact: true });
  await natural.click(); await natural.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '参考演绎', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('tab', { name: '常规', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', { name: '界面语言', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '常规', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel', { name: '模型', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '界面语言', exact: true })).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '推理引擎', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel', { name: '推理引擎' })).toBeVisible();
  await page.getByRole('button', { name: '创作', exact: true }).click();
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: '录音名称' })).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles({ name: '损坏.wav', mimeType: 'audio/wav', buffer: Buffer.from('invalid') });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

for (const trigger of ['鼠标', '键盘']) test(`选中文字显示发音浮层，${trigger}应用后只修改选区`, async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: '正文', exact: true });
  const action = page.getByRole('button', { name: '调整发音', exact: true });
  await expect(action).toHaveCount(0);
  await expect(page.getByRole('button', { name: '段间停顿', exact: true })).toHaveCount(0);
  await editor.fill('银行需要核对资料。');
  await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0));
  await editor.press('Shift+ArrowRight'); await editor.press('Shift+ArrowRight');
  await expect(action).toBeVisible();
  if (trigger === '鼠标') await action.click();
  else {
    await editor.press('Tab'); await expect(action).toBeFocused();
    await action.press('Enter');
  }
  await expect(page.getByRole('dialog')).toContainText('银行');
  await page.getByPlaceholder('例如 HANG2').fill('YIN2 HANG2');
  await page.getByRole('button', { name: '应用发音' }).click();
  await expect(editor).toHaveValue('<银行|YIN2 HANG2>需要核对资料。');
  await expect(action).toHaveCount(0);
  await editor.focus(); await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0)); await editor.press('Shift+ArrowRight');
  await expect(action).toBeVisible();
  await editor.press('ArrowRight'); await expect(action).toHaveCount(0);
  await editor.press('Shift+ArrowLeft'); await expect(action).toBeVisible();
  await editor.press('Escape'); await expect(action).toHaveCount(0);
  await page.locator('.advanced summary').click();
  await expect(page.getByRole('spinbutton', { name: '段间停顿（毫秒）' })).toBeVisible();
});

test('下载进度归属具体精度，菜单不覆盖触发按钮', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '模型', exact: true }).click();
  const source = page.getByRole('combobox', { name: '下载来源', exact: true });
  await source.click();
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  await expect.poll(async () => {
    const button = await source.boundingBox(); const popup = await menu.boundingBox();
    return !!button && !!popup && popup.y >= button.y + button.height;
  }).toBeTruthy();
  await page.keyboard.press('Escape');
  await page.evaluate(state => {
    state.models = [{ id: 'index-2.5-q8', path: '/models/index.gguf', managed: false }];
    state.activity = { errorCode: null, errorParams: null, kind: 'download', modelId: 'index-2-q8', code: '@yovoice.activity.verifying', params: null, status: 'running', received: 3633888608, total: 3633888608 };
    localStorage.setItem('voice-workbench-v1', JSON.stringify(state));
  }, emptyState());
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '模型', exact: true }).click();
  const row = page.locator('.model-row').filter({ has: page.getByRole('progressbar', { name: 'IndexTTS 2.0 Q8 下载进度' }) });
  await expect(row).toContainText('正在校验');
  await expect(page.getByRole('button', { name: '移除模型', exact: true })).toBeEnabled();
  await expect(row.getByRole('button', { name: '暂停' })).toBeVisible();
  await expect(page.locator('.activity')).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toHaveCount(1);
});

test('生成状态仅在右侧显示，已用时间持续更新', async ({ page }) => {
  const state = emptyState();
  state.activity = { kind: 'generate', code: '@yovoice.activity.synthesizing', params: null, status: 'running', received: 0, total: 0, errorCode: null, errorParams: null, startedAt: new Date(Date.now() - 10000).toISOString() };
  await page.addInitScript(state => localStorage.setItem('voice-workbench-v1', JSON.stringify(state)), state);
  await page.goto('/');
  await expect(page.locator('.generation-action')).toContainText(/加载模型|合成语音|Loading model|Synthesizing/i);
  await expect(page.getByRole('button', { name: '取消生成', exact: true })).toHaveCount(1);
  await expect(page.locator('.activity')).toHaveCount(0);
  const elapsed = page.getByLabel('已用时间', { exact: true });
  const initial = await elapsed.textContent();
  await expect.poll(() => elapsed.textContent()).not.toBe(initial);
});


test('作品列表可滚动，删除当前作品后不会被自动保存恢复', async ({ page }) => {
  const state = emptyState();
  state.drafts = Array.from({ length: 18 }, (_, index) => ({ ...state.drafts[0], id: index.toString(16).padStart(32, '0'), title: `作品 ${index + 1}` }));
  await page.addInitScript(state => { if (!localStorage.getItem('voice-workbench-v1')) localStorage.setItem('voice-workbench-v1', JSON.stringify(state)); }, state);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const list = page.locator('.project-list');
  await expect(page.locator('.project-row')).toHaveCount(18);
  await expect.poll(() => list.evaluate(el => el.scrollHeight > el.clientHeight)).toBeTruthy();
  await page.getByRole('button', { name: '作品 18', exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '作品 18', exact: true }).click();
  await page.getByLabel('正文', { exact: true }).fill('刚刚修改的内容');
  await page.locator('.project-row.current').hover();
  await page.getByRole('button', { name: '删除作品：作品 18', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除作品', exact: true }).click();
  await expect(page.locator('.project-row')).toHaveCount(17);
  await expect(page.getByLabel('作品名称')).toHaveValue('作品 1');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '作品 18', exact: true })).toHaveCount(0);
  await expect(page.locator('.project-row')).toHaveCount(17);
});

test('底部切换当前作品历史，同步正文和生成参数', async ({ page }) => {
  const state = emptyState();
  const draft = state.drafts[0];
  state.history = [
    { id: 'new', title: draft.title, fileName: 'history.wav', createdAt: '2026-09-15T10:00:00Z', duration: 1, settings: { ...draft, mode: 'text', speed: 1.2, text: '新版正文' } },
    { id: 'old', title: draft.title, fileName: 'history.wav', createdAt: '2026-09-15T09:00:00Z', duration: 1, settings: { ...draft, modelId: 'index-2-q8', mode: 'speaker', speed: 0.8, text: '旧版正文' } },
    { id: 'other', title: '其他作品', fileName: 'history.wav', createdAt: '2026-09-15T08:00:00Z', duration: 1, settings: { ...draft, id: 'other' } },
  ];
  await page.goto('/');
  await page.evaluate(async state => {
    localStorage.setItem('voice-workbench-v1', JSON.stringify(state));
    const bytes = new Uint8Array(32044); const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
    text(0, 'RIFF'); view.setUint32(4, 32036, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 32000, true);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('voice-workbench-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('audio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(new Blob([bytes], { type: 'audio/wav' }), 'history.wav'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  }, state);
  await page.reload();
  const selector = page.getByRole('combobox', { name: '当前作品历史' });
  await expect(selector).toContainText('版本 2');
  await selector.click();
  await expect(page.getByRole('option')).toHaveCount(2);
  const menu = await page.getByRole('listbox').boundingBox(); const trigger = await selector.boundingBox();
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(trigger!.y);
  await page.getByRole('option', { name: /版本 1/ }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('旧版正文');
  await expect(page.getByRole('radio', { name: '跟随音色', exact: true })).toBeChecked();
  await expect(page.getByRole('slider', { name: '语速', exact: true })).toHaveAttribute('aria-valuenow', '0.8');
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toContainText('IndexTTS 2.0');
  await expect.poll(() => page.locator('footer audio').evaluate((audio: HTMLAudioElement) => audio.duration)).toBe(1);
  await selector.click(); await page.getByRole('option', { name: /版本 2/ }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('新版正文');
  await expect(page.getByRole('radio', { name: '文字指导', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  await page.getByRole('button', { name: `删除历史${draft.title}`, exact: true }).first().click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.history-item')).toHaveCount(3);
  await page.getByRole('button', { name: `试听${draft.title}`, exact: true }).first().click();
  await page.getByRole('button', { name: `删除历史${draft.title}`, exact: true }).first().click();
  await page.getByRole('button', { name: '删除历史', exact: true }).click();
  await expect(page.locator('.history-item')).toHaveCount(2);
  await expect(page.locator('.history-item audio')).toHaveCount(0);
  await page.getByRole('button', { name: '创作', exact: true }).click();
  await expect(selector).toContainText('版本 1');
  await page.reload();
  await expect(selector).toContainText('版本 1');
  await page.getByRole('button', { name: '新建作品', exact: true }).click();
  await expect(selector).toHaveCount(0);
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
});

test('侧栏拖拽调宽、收起和恢复会记住状态', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto('/');
  const sidebar = page.getByRole('navigation', { name: '主导航' });
  const handle = page.getByRole('separator', { name: '调整侧栏宽度' });
  const panel = page.locator('.astryx-app-shell-sidenav');
  // 内层侧栏必须适配外层内容宽度，避免分隔线挤出横向滚动条。
  await expect.poll(() => panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  const initial = (await sidebar.boundingBox())!.width;
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(initial + 40);
  const resized = (await sidebar.boundingBox())!.width;
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect(sidebar).toHaveCount(0);
  await page.reload(); await expect(sidebar).toHaveCount(0);
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(resized, 0);
  await handle.focus(); await handle.press('ArrowLeft');
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(resized);
  await page.evaluate(() => window.dispatchEvent(new Event('workbench-toggle-sidebar')));
  await expect(sidebar).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('workbench-toggle-sidebar')));
  await expect(sidebar).toBeVisible();
  for (const width of [840, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
    await expect(page.getByTestId('nav-settings')).toBeInViewport();
  }
});


test('声音库管理复用重命名和删除，清理当前音色引用', async ({ page }, testInfo) => {
  const state = emptyState();
  state.voices = [{ id: 'voice', name: '测试音色', fileName: 'voice.wav', duration: 3 }];
  state.drafts[0].voiceId = 'voice';
  await page.goto('/');
  await page.evaluate(state => localStorage.setItem('voice-workbench-v1', JSON.stringify(state)), state);
  await page.reload();
  await page.getByRole('button', { name: '声音库', exact: true }).click();
  await page.getByRole('button', { name: '编辑音色信息', exact: true }).click();
  await page.getByLabel('音色名称').fill('新音色');
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('edit-voice.png') });
  await page.getByRole('button', { name: '保存音色', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开位置新音色', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除声音新音色', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog').getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '删除声音', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加第一个声音', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '创作', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts[0].voiceId)).toBeNull();
});


test('声音库和历史仅列表滚动，标题位置保持固定', async ({ page }) => {
  const state = emptyState();
  state.voices = Array.from({ length: 30 }, (_, i) => ({ id: `voice-${i}`, name: `声音 ${i}`, fileName: `${i}.wav`, duration: 3 }));
  state.history = Array.from({ length: 30 }, (_, i) => ({ id: `history-${i}`, title: `历史 ${i}`, fileName: `${i}.wav`, createdAt: '2026-09-15T10:00:00Z', duration: 3, settings: state.drafts[0] }));
  await page.goto('/');
  await page.evaluate(state => localStorage.setItem('voice-workbench-v1', JSON.stringify(state)), state);
  await page.reload();
  for (const [name, selector, last] of [['声音库', '.voice-library-list', '声音 29'], ['历史记录', '.history-list', '历史 29']]) {
    await page.getByRole('button', { name, exact: true }).click();
    const heading = page.getByRole('heading', { name, exact: true });
    const before = await heading.boundingBox();
    const list = page.locator(selector);
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: last, exact: true })).toBeInViewport();
    expect((await heading.boundingBox())!.y).toBe(before!.y);
  }
});


test('设置仅内容区滚动，标题和页签保持固定', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '模型', exact: true }).click();
  const heading = page.getByRole('heading', { name: '设置', exact: true });
  const tabs = page.getByRole('tablist');
  for (const width of [1000, 800]) {
    await page.setViewportSize({ width, height: 600 });
    const titleBox = (await heading.boundingBox())!;
    const newBox = (await page.getByTestId('nav-new').boundingBox())!;
    const tabBox = (await page.getByRole('tab', { name: '常规', exact: true }).boundingBox())!;
    const createBox = (await page.getByTestId('nav-create').boundingBox())!;
    expect(Math.abs(titleBox.y + titleBox.height / 2 - newBox.y - newBox.height / 2)).toBeLessThan(1);
    expect(Math.abs(tabBox.y + tabBox.height / 2 - createBox.y - createBox.height / 2)).toBeLessThan(1);
  }
  const headingBefore = await heading.boundingBox();
  const tabsBefore = await tabs.boundingBox();
  const panel = page.getByRole('tabpanel', { name: '模型', exact: true });
  await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => panel.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'IndexTTS 协议', exact: true })).toBeInViewport();
  expect((await heading.boundingBox())!.y).toBe(headingBefore!.y);
  expect((await tabs.boundingBox())!.y).toBe(tabsBefore!.y);
});

test('录音权限拒绝时给出可操作提示', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  await page.getByRole('button', { name: '录制声音', exact: true }).click();
  await page.getByRole('button', { name: '开始录音', exact: true }).click();
  await expect(page.getByText('无法访问麦克风，请在浏览器的网站权限和系统设置中允许使用麦克风后重试。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始录音', exact: true })).toBeEnabled();
});

test('桌面导入将压缩音频原样交给后端转换', async ({ page }) => {
  await page.addInitScript(state => {
    let receive: (event: { data: unknown }) => void;
    Object.assign(window, { chrome: { webview: {
      addEventListener: (_name: string, listener: typeof receive) => { receive = listener; },
      postMessage: (message: { id: string; method: string; data: { base64?: string; name?: string } }) => {
        let result: unknown = true;
        if (message.method === 'state.get') result = { state, catalog: [], desktop: true };
        if (message.method === 'voice.record') {
          localStorage.setItem('uploaded-audio', JSON.stringify(message.data));
          result = { id: 'imported', name: message.data.name, fileName: 'imported.wav', duration: 2 };
        }
        queueMicrotask(() => receive({ data: { id: message.id, result } }));
      },
    } } });
  }, emptyState());
  await page.goto('/');
  await page.getByRole('button', { name: '声音库', exact: true }).click();
  await page.getByRole('button', { name: '添加第一个声音', exact: true }).click();
  const bytes = Buffer.from('compressed audio handled by the desktop service');
  await page.locator('input[type=file]').setInputFiles({ name: '参考.mp3', mimeType: 'audio/mpeg', buffer: bytes });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('uploaded-audio'))).not.toBeNull();
  const uploaded = JSON.parse((await page.evaluate(() => localStorage.getItem('uploaded-audio')))!);
  expect(uploaded.name).toBe('参考');
  expect(uploaded.base64).toBe(bytes.toString('base64'));
});


test('VoxCPM2 模式切换与草稿保存', async ({ page }) => {
  await page.goto('/');
  const model = page.getByRole('combobox', { name: '模型', exact: true });
  await model.click();
  await page.getByRole('option', { name: /VoxCPM2 · Q8/ }).click();
  await expect(page.getByRole('radio', { name: '声音设计', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '情绪调节', exact: true })).toHaveCount(0);
  await page.getByLabel('声音描述', { exact: true }).fill('清澈温柔的年轻女性');
  await page.getByRole('radio', { name: '音色克隆', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await expect(page.getByLabel('风格指导（可选）')).toHaveValue('清澈温柔的年轻女性');
  await page.getByRole('radio', { name: '精细克隆', exact: true }).click();
  await page.getByLabel('参考音频原文').fill('这是参考音频中的原文。');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('参考音频原文')).toHaveValue('这是参考音频中的原文。');
  await model.click();
  await page.getByRole('option', { name: /IndexTTS 2.5 · Q8/ }).click();
  await expect(page.getByRole('radio', { name: '跟随音色', exact: true })).toBeVisible();
  await expect(page.getByLabel('参考音频原文')).toHaveCount(0);
});

test('OmniVoice 和 Qwen3-TTS 使用各自的声音控件', async ({ page }) => {
  await page.goto('/');
  const model = page.getByRole('combobox', { name: '模型', exact: true });
  await model.click();
  await page.getByRole('option', { name: /OmniVoice · Q8/ }).click();
  await expect(page.getByRole('radio', { name: '声音设计', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: '性别', exact: true }).click();
  const genderTrigger = await page.getByRole('combobox', { name: '性别', exact: true }).boundingBox();
  const genderMenu = await page.getByRole('listbox').boundingBox();
  expect(genderMenu!.y).toBeGreaterThanOrEqual(genderTrigger!.y + genderTrigger!.height);
  await page.getByRole('option', { name: '女', exact: true }).click();
  await page.locator('summary').filter({ hasText: '非语言声音' }).click();
  const tags = page.getByRole('combobox', { name: '非语言声音', exact: true });
  await tags.click();
  const tagTrigger = await tags.boundingBox();
  const tagMenu = await page.getByRole('listbox').boundingBox();
  expect(tagMenu!.y >= tagTrigger!.y + tagTrigger!.height || tagMenu!.y + tagMenu!.height <= tagTrigger!.y).toBe(true);
  await page.getByRole('option', { name: '[laughter]', exact: true }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(/\[laughter\]$/);
  await page.getByRole('radio', { name: '音色克隆', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await page.getByLabel('参考音频原文').fill('你好。');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: '音色克隆', exact: true })).toBeChecked();
  await expect(page.getByLabel('参考音频原文')).toHaveValue('你好。');
  await model.click();
  await page.getByRole('option', { name: /Qwen3-TTS 1.7B Base · Q8/ }).click();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '声音设计', exact: true })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '情绪调节', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('参考音频原文（可选）')).toHaveValue('你好。');
});


test('Qwen 变体、独立参数与离线生成控件', async ({ page }) => {
  await page.goto('/');
  const model = page.getByRole('combobox', { name: '模型', exact: true });
  await model.click();
  await page.getByRole('option', { name: /Qwen3-TTS 1.7B CustomVoice · Q8/ }).click();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: '内置音色', exact: true }).click();
  await page.getByRole('option', { name: /^Ryan/ }).click();
  await page.getByLabel('声音描述', { exact: true }).fill('轻松愉快');
  await page.getByText('高级设置', { exact: true }).click();
  await expect(page.getByLabel('重复惩罚', { exact: true })).toHaveValue('1.05');
  await page.getByLabel('温度', { exact: true }).fill('0.7');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('combobox', { name: '内置音色', exact: true })).toContainText('Ryan');
  await model.click();
  await page.getByRole('option', { name: /Qwen3-TTS 1.7B VoiceDesign · Q8/ }).click();
  await expect(page.getByRole('combobox', { name: '内置音色', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('声音描述', { exact: true })).toBeVisible();
  await model.click();
  await page.getByRole('option', { name: /IndexTTS 2.5 · Q8/ }).click();
  await page.getByText('高级设置', { exact: true }).click();
  await expect(page.getByLabel('重复惩罚', { exact: true })).toHaveValue('10');
  await expect(page.getByText('流式生成', { exact: true })).toHaveCount(0);
});
